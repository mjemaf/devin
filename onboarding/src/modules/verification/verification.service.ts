import { Inject, Injectable } from '@nestjs/common';
import {
  BusinessType,
  Prisma,
  StepStatus,
  VerificationAttempt,
  VerificationMethod,
  VerificationStatus,
} from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ApiException } from '../../common/errors/api.exception';
import { newPublicId } from '../../common/ids';
import { AuthContext } from '../../common/auth/auth.types';
import { MerchantsService } from '../merchants/merchants.service';
import { OnboardingStepsService } from '../merchants/onboarding-steps.service';
import { BankAccountsService } from '../bank-accounts/bank-accounts.service';
import { WebhookDispatcherService } from '../webhooks/webhook-dispatcher.service';
import {
  ProviderResult,
  VERIFICATION_PROVIDER,
  VerificationProvider,
} from './providers/verification-provider';
import { VerifyBankAccountDto, VerifyBusinessDto, VerifyIdentityDto } from './dto/verify.dto';

interface BusinessProfileView {
  legal_name: string;
  tax_id_token?: string;
  tax_id_last4?: string;
  registration_number?: string;
}

@Injectable()
export class VerificationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly merchants: MerchantsService,
    private readonly steps: OnboardingStepsService,
    private readonly bankAccounts: BankAccountsService,
    private readonly webhooks: WebhookDispatcherService,
    @Inject(VERIFICATION_PROVIDER) private readonly provider: VerificationProvider,
  ) {}

  async verifyBusiness(auth: AuthContext, dto: VerifyBusinessDto): Promise<VerificationAttempt> {
    const merchant = await this.merchants.findForPartner(auth, dto.merchant_id);
    const profile = merchant.businessProfile as unknown as BusinessProfileView;
    if (!profile.tax_id_token) {
      throw ApiException.conflict(
        'Submit business details via POST /merchants/{merchant_id}/business-verification first',
        'business_details_missing',
      );
    }

    const result = await this.provider.verifyBusiness({
      legalName: profile.legal_name,
      taxIdLast4: profile.tax_id_last4,
      registrationNumber: profile.registration_number,
      country: merchant.country,
      sources: dto.verification_sources ?? ['government_registry'],
    });

    const attempt = await this.recordAttempt(merchant.id, 'business', null, dto, result);
    await this.steps.setStatus(
      merchant.id,
      'business_verification',
      this.stepStatusFor(result.status),
      result.status === VerificationStatus.verified ? [] : ['resolve_business_verification'],
    );
    await this.emitOutcome(merchant.partnerId, merchant.publicId, 'business', result);
    return attempt;
  }

  async verifyIdentity(auth: AuthContext, dto: VerifyIdentityDto): Promise<VerificationAttempt> {
    const merchant = await this.merchants.findForPartner(auth, dto.merchant_id);
    const owner = await this.prisma.owner.findFirst({
      where: { merchantId: merchant.id, publicId: dto.owner_id },
      include: { documents: true },
    });
    if (!owner) {
      throw ApiException.notFound('owner', dto.owner_id);
    }

    const method = dto.verification_method ?? 'database_check';
    const result = await this.provider.verifyIdentity({
      firstName: owner.firstName,
      lastName: owner.lastName,
      dateOfBirth: owner.dateOfBirth.toISOString().slice(0, 10),
      country: merchant.country,
      method,
      hasIdDocument: owner.documents.some((document) =>
        ['government_id', 'passport'].includes(document.documentType),
      ),
    });

    await this.prisma.owner.update({
      where: { id: owner.id },
      data: { verificationStatus: result.status },
    });
    const attempt = await this.recordAttempt(merchant.id, 'identity', owner.publicId, dto, result);

    if (merchant.businessType === BusinessType.company) {
      const outstanding = await this.prisma.owner.count({
        where: { merchantId: merchant.id, verificationStatus: { not: VerificationStatus.verified } },
      });
      await this.steps.setStatus(
        merchant.id,
        'owner_verification',
        outstanding === 0 ? StepStatus.completed : StepStatus.in_progress,
        outstanding === 0 ? [] : ['verify_owner_identity'],
      );
    }
    await this.emitOutcome(merchant.partnerId, merchant.publicId, 'identity', result);
    return attempt;
  }

  async verifyBankAccount(
    auth: AuthContext,
    dto: VerifyBankAccountDto,
  ): Promise<VerificationAttempt> {
    const merchant = await this.merchants.findForPartner(auth, dto.merchant_id);
    const account = await this.bankAccounts.findForMerchant(merchant.id, dto.bank_account_id);
    const method = dto.verification_method ?? 'instant';

    if (method === 'micro_deposits') {
      await this.prisma.bankAccount.update({
        where: { id: account.id },
        data: {
          verificationMethod: VerificationMethod.micro_deposits,
          verificationStatus: VerificationStatus.pending,
        },
      });
      return this.recordAttempt(merchant.id, 'bank_account', account.publicId, dto, {
        status: VerificationStatus.pending,
        provider: 'micro_deposits',
        details: { required_action: 'confirm_micro_deposits' },
      });
    }

    const result = await this.provider.verifyBankAccount({
      routingNumber: account.routingNumber,
      accountNumberLast4: account.accountNumberLast4,
      accountHolderName: account.accountHolderName,
      currency: account.currency,
    });
    const updated = await this.prisma.bankAccount.update({
      where: { id: account.id },
      data: { verificationStatus: result.status, verificationMethod: VerificationMethod.instant },
    });
    const attempt = await this.recordAttempt(
      merchant.id,
      'bank_account',
      account.publicId,
      dto,
      result,
    );

    if (result.status === VerificationStatus.verified) {
      await this.bankAccounts.markSettlementReady(merchant.id, merchant.partnerId, updated);
    } else {
      await this.steps.setStatus(merchant.id, 'bank_account_setup', StepStatus.failed, [
        'add_bank_account',
      ]);
    }
    await this.emitOutcome(merchant.partnerId, merchant.publicId, 'bank_account', result);
    return attempt;
  }

  async attempts(auth: AuthContext, merchantPublicId: string) {
    const merchant = await this.merchants.findForPartner(auth, merchantPublicId);
    return this.prisma.verificationAttempt.findMany({
      where: { merchantId: merchant.id },
      orderBy: { startedAt: 'desc' },
    });
  }

  private stepStatusFor(status: VerificationStatus): StepStatus {
    if (status === VerificationStatus.verified) {
      return StepStatus.completed;
    }
    return status === VerificationStatus.failed ? StepStatus.failed : StepStatus.in_progress;
  }

  private async recordAttempt(
    merchantId: string,
    type: string,
    subjectId: string | null,
    request: object,
    result: ProviderResult,
  ): Promise<VerificationAttempt> {
    return this.prisma.verificationAttempt.create({
      data: {
        publicId: newPublicId('ver'),
        merchantId,
        verificationType: type,
        subjectId,
        provider: result.provider,
        status: result.status,
        requestData: request as unknown as Prisma.InputJsonValue,
        responseData: result.details as unknown as Prisma.InputJsonValue,
        errorMessage: result.errorMessage,
        completedAt: result.status === VerificationStatus.pending ? null : new Date(),
      },
    });
  }

  private async emitOutcome(
    partnerId: string,
    merchantPublicId: string,
    type: string,
    result: ProviderResult,
  ): Promise<void> {
    if (result.status === VerificationStatus.pending) {
      return;
    }
    await this.webhooks.emit(
      partnerId,
      result.status === VerificationStatus.verified
        ? 'merchant.verification_completed'
        : 'merchant.verification_failed',
      {
        merchant_id: merchantPublicId,
        verification_type: type,
        status: result.status,
        error: result.errorMessage ?? null,
      },
    );
  }
}
