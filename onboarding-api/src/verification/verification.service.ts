import { Inject, Injectable } from '@nestjs/common';
import {
  BankAccount,
  Merchant,
  Owner,
  Prisma,
  VerificationStatus,
  VerificationMethod,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthContext } from '../auth/auth-context';
import { ComplianceService } from '../compliance/compliance.service';
import { ApiException } from '../common/errors/api.exception';
import { newId } from '../common/ids';
import { MerchantStateService } from '../merchants/merchant-state.service';
import { BusinessProfileJson } from '../merchants/merchant.types';
import { WebhooksService } from '../webhooks/webhooks.service';
import {
  BANK_VERIFICATION_PROVIDER,
  BankVerificationProvider,
  BUSINESS_VERIFICATION_PROVIDER,
  BusinessVerificationProvider,
  IDENTITY_VERIFICATION_PROVIDER,
  IdentityVerificationProvider,
  ProviderResult,
} from './providers/verification-provider';

const STATUS_BY_PROVIDER_RESULT: Record<ProviderResult['status'], VerificationStatus> = {
  verified: VerificationStatus.verified,
  failed: VerificationStatus.failed,
  in_progress: VerificationStatus.in_progress,
};

@Injectable()
export class VerificationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly merchantState: MerchantStateService,
    private readonly compliance: ComplianceService,
    private readonly webhooks: WebhooksService,
    private readonly audit: AuditService,
    @Inject(BUSINESS_VERIFICATION_PROVIDER)
    private readonly businessProvider: BusinessVerificationProvider,
    @Inject(IDENTITY_VERIFICATION_PROVIDER)
    private readonly identityProvider: IdentityVerificationProvider,
    @Inject(BANK_VERIFICATION_PROVIDER)
    private readonly bankProvider: BankVerificationProvider,
  ) {}

  async verifyBusiness(auth: AuthContext, merchantId: string, expedited = false) {
    const merchant = await this.merchantState.findForPartner(auth.partnerId, merchantId);
    const profile = merchant.businessProfile as unknown as BusinessProfileJson;
    const region = this.compliance.region(merchant.country);

    if (!profile.legal_name) {
      throw ApiException.validation(
        'business_information_missing',
        'Submit business information before requesting business verification',
        'legal_name',
      );
    }

    const result = await this.businessProvider.verify({
      legalName: profile.legal_name,
      taxId: profile.tax_id_token ?? undefined,
      registrationNumber: profile.registration_number ?? undefined,
      country: merchant.country,
      registries: region.businessRegistries,
      screeningLists: region.screeningLists,
      website: profile.website ?? undefined,
    });

    const attempt = await this.recordAttempt(merchant.id, null, 'business', result, {
      expedited,
      registries: region.businessRegistries,
    });

    await this.merchantState.advanceStep(
      merchant,
      'business_verification',
      result.status === 'verified' ? 'completed' : 'failed',
      result.status === 'verified' ? [] : ['resubmit_business_information'],
    );

    // Region-specific checks that ride along with the registry lookup.
    for (const step of region.additionalSteps) {
      if (step === 'tax_id_verification' || step.endsWith('_check') || step.endsWith('_enrolment')) {
        const refreshed = await this.merchantState.findForPartner(auth.partnerId, merchant.id);
        await this.merchantState.advanceStep(
          refreshed,
          step,
          result.status === 'verified' ? 'completed' : 'failed',
          result.status === 'verified' ? [] : ['resubmit_business_information'],
        );
      }
    }

    await this.emitOutcome(merchant, 'business', result);
    await this.audit.record(auth, {
      merchantId: merchant.id,
      action: 'verification.business',
      resourceType: 'verification_attempt',
      resourceId: attempt.id,
      changes: { status: result.status, provider: result.provider },
    });

    return this.serialiseAttempt(attempt.id, merchant.id, 'business', result);
  }

  async verifyIdentity(
    auth: AuthContext,
    merchantId: string,
    ownerId: string,
    method: 'document_upload' | 'biometric' | 'database_check',
    consent: boolean,
  ) {
    if (!consent) {
      throw ApiException.validation(
        'consent_required',
        'Explicit consent is required before running identity verification',
        'consent',
      );
    }

    const merchant = await this.merchantState.findForPartner(auth.partnerId, merchantId);
    const owner = await this.prisma.owner.findFirst({ where: { id: ownerId, merchantId } });
    if (!owner) throw ApiException.notFound('owner', ownerId);

    const region = this.compliance.region(merchant.country);
    const identityDocuments = await this.prisma.document.count({
      where: {
        ownerId: owner.id,
        documentType: { in: ['government_id', 'passport', 'drivers_license'] },
      },
    });

    const result = await this.identityProvider.verify({
      firstName: owner.firstName,
      lastName: owner.lastName,
      dateOfBirth: owner.dateOfBirth.toISOString().slice(0, 10),
      country: merchant.country,
      taxIdLast4: owner.taxIdLast4 ?? undefined,
      method,
      hasIdentityDocument: identityDocuments > 0,
      screeningLists: region.screeningLists,
    });

    const attempt = await this.recordAttempt(merchant.id, owner.id, 'identity', result, { method });

    await this.prisma.owner.update({
      where: { id: owner.id },
      data: { verificationStatus: STATUS_BY_PROVIDER_RESULT[result.status] },
    });
    await this.refreshOwnerVerificationStep(merchant);
    await this.emitOutcome(merchant, 'identity', result, { owner_id: owner.id });
    await this.audit.record(auth, {
      merchantId: merchant.id,
      action: 'verification.identity',
      resourceType: 'verification_attempt',
      resourceId: attempt.id,
      changes: { owner_id: owner.id, status: result.status },
    });

    return this.serialiseAttempt(attempt.id, merchant.id, 'identity', result, { owner_id: owner.id });
  }

  async verifyBankAccount(
    auth: AuthContext,
    merchantId: string,
    bankAccountId: string,
    method: 'instant' | 'micro_deposits',
    rawAccountNumber?: string,
  ) {
    const merchant = await this.merchantState.findForPartner(auth.partnerId, merchantId);
    const account = await this.prisma.bankAccount.findFirst({
      where: { id: bankAccountId, merchantId },
    });
    if (!account) throw ApiException.notFound('bank_account', bankAccountId);

    const region = this.compliance.region(merchant.country);
    const result = await this.bankProvider.verify({
      accountHolderName: account.accountHolderName,
      routingNumber: account.routingNumber,
      // The raw number is only in hand at creation time; afterwards only the token is
      // retained, so structural validity is carried forward from the stored status.
      accountNumber: rawAccountNumber,
      preValidated: account.verificationStatus !== VerificationStatus.failed,
      format: region.bankAccountFormat,
      method,
    });

    const attempt = await this.recordAttempt(merchant.id, account.id, 'bank_account', result, {
      method,
    });

    const microDeposits =
      result.status === 'in_progress' ? [this.pseudoAmount(account.id, 1), this.pseudoAmount(account.id, 2)] : [];

    const updated = await this.prisma.bankAccount.update({
      where: { id: account.id },
      data: {
        verificationStatus: STATUS_BY_PROVIDER_RESULT[result.status],
        verificationMethod:
          method === 'instant' ? VerificationMethod.instant : VerificationMethod.micro_deposits,
        microDepositAmounts: microDeposits,
      },
    });

    await this.syncBankStep(merchant, updated);
    await this.emitBankOutcome(merchant, updated, result);

    return {
      ...this.serialiseAttempt(attempt.id, merchant.id, 'bank_account', result, {
        bank_account_id: account.id,
      }),
      ...(microDeposits.length > 0
        ? { next_action: 'confirm_micro_deposits', micro_deposit_count: microDeposits.length }
        : {}),
    };
  }

  async confirmMicroDeposits(
    auth: AuthContext,
    merchantId: string,
    bankAccountId: string,
    amounts: number[],
  ) {
    const merchant = await this.merchantState.findForPartner(auth.partnerId, merchantId);
    const account = await this.prisma.bankAccount.findFirst({
      where: { id: bankAccountId, merchantId },
    });
    if (!account) throw ApiException.notFound('bank_account', bankAccountId);
    if (account.microDepositAmounts.length === 0) {
      throw ApiException.conflict(
        'micro_deposits_not_pending',
        'No micro-deposit verification is pending for this bank account',
      );
    }

    const submitted = [...amounts].sort((a, b) => a - b);
    const expected = [...account.microDepositAmounts].sort((a, b) => a - b);
    const matches =
      submitted.length === expected.length &&
      submitted.every((amount, index) => amount === expected[index]);

    const updated = await this.prisma.bankAccount.update({
      where: { id: account.id },
      data: {
        verificationStatus: matches ? VerificationStatus.verified : VerificationStatus.failed,
        microDepositAmounts: matches ? [] : account.microDepositAmounts,
      },
    });

    await this.syncBankStep(merchant, updated);
    await this.audit.record(auth, {
      merchantId: merchant.id,
      action: 'verification.bank_account.micro_deposits',
      resourceType: 'bank_account',
      resourceId: account.id,
      changes: { verified: matches },
    });
    await this.webhooks.publish(
      merchant.partnerId,
      matches ? 'bank_account.verified' : 'bank_account.verification_failed',
      { merchant_id: merchant.id, bank_account_id: account.id },
    );

    if (!matches) {
      throw ApiException.validation(
        'micro_deposit_amounts_mismatch',
        'The submitted micro-deposit amounts do not match the amounts that were sent',
        'amounts',
      );
    }

    return { bank_account_id: account.id, verification_status: updated.verificationStatus };
  }

  async listAttempts(auth: AuthContext, merchantId: string) {
    await this.merchantState.findForPartner(auth.partnerId, merchantId);
    const attempts = await this.prisma.verificationAttempt.findMany({
      where: { merchantId },
      orderBy: { startedAt: 'desc' },
    });
    return {
      data: attempts.map((attempt) => ({
        id: attempt.id,
        verification_type: attempt.verificationType,
        subject_id: attempt.subjectId,
        status: attempt.status,
        provider: attempt.provider,
        response: attempt.responseData,
        error_message: attempt.errorMessage,
        started_at: attempt.startedAt,
        completed_at: attempt.completedAt,
      })),
    };
  }

  private async recordAttempt(
    merchantId: string,
    subjectId: string | null,
    type: string,
    result: ProviderResult,
    request: Prisma.InputJsonValue,
  ) {
    return this.prisma.verificationAttempt.create({
      data: {
        id: newId('verification'),
        merchantId,
        subjectId,
        verificationType: type,
        status: STATUS_BY_PROVIDER_RESULT[result.status],
        provider: result.provider,
        requestData: request,
        responseData: {
          checks: result.checks,
          match_score: result.matchScore,
        } as unknown as Prisma.InputJsonValue,
        errorMessage: result.failureReason,
        completedAt: result.status === 'in_progress' ? null : new Date(),
      },
    });
  }

  private serialiseAttempt(
    attemptId: string,
    merchantId: string,
    type: string,
    result: ProviderResult,
    extra: Record<string, unknown> = {},
  ) {
    return {
      verification_id: attemptId,
      merchant_id: merchantId,
      verification_type: type,
      status: STATUS_BY_PROVIDER_RESULT[result.status],
      provider: result.provider,
      checks: result.checks,
      match_score: result.matchScore,
      failure_reason: result.failureReason ?? null,
      ...extra,
    };
  }

  private async refreshOwnerVerificationStep(merchant: Merchant): Promise<void> {
    const owners = await this.prisma.owner.findMany({ where: { merchantId: merchant.id } });
    const current = await this.merchantState.findForPartner(merchant.partnerId, merchant.id);

    if (owners.some((owner: Owner) => owner.verificationStatus === VerificationStatus.failed)) {
      await this.merchantState.advanceStep(current, 'owner_verification', 'failed', [
        'resubmit_owner_identity',
      ]);
      return;
    }
    const allVerified =
      owners.length > 0 &&
      owners.every((owner: Owner) => owner.verificationStatus === VerificationStatus.verified);
    await this.merchantState.advanceStep(
      current,
      'owner_verification',
      allVerified ? 'completed' : 'in_progress',
      allVerified ? [] : ['verify_remaining_owners'],
    );
  }

  private async syncBankStep(merchant: Merchant, account: BankAccount): Promise<void> {
    const current = await this.merchantState.findForPartner(merchant.partnerId, merchant.id);
    if (account.verificationStatus === VerificationStatus.verified) {
      await this.merchantState.advanceStep(current, 'bank_account_setup', 'completed');
    } else if (account.verificationStatus === VerificationStatus.failed) {
      await this.merchantState.advanceStep(current, 'bank_account_setup', 'failed', [
        'correct_bank_account_details',
      ]);
    } else {
      await this.merchantState.advanceStep(current, 'bank_account_setup', 'in_progress', [
        'verify_bank_account',
      ]);
    }
  }

  private async emitOutcome(
    merchant: Merchant,
    type: string,
    result: ProviderResult,
    extra: Record<string, unknown> = {},
  ): Promise<void> {
    if (result.status === 'in_progress') return;
    await this.webhooks.publish(
      merchant.partnerId,
      result.status === 'verified' ? 'merchant.verification_completed' : 'merchant.verification_failed',
      {
        merchant_id: merchant.id,
        verification_type: type,
        status: result.status,
        failure_reason: result.failureReason ?? null,
        ...extra,
      },
    );
  }

  private async emitBankOutcome(
    merchant: Merchant,
    account: BankAccount,
    result: ProviderResult,
  ): Promise<void> {
    if (result.status === 'in_progress') return;
    await this.webhooks.publish(
      merchant.partnerId,
      result.status === 'verified' ? 'bank_account.verified' : 'bank_account.verification_failed',
      {
        merchant_id: merchant.id,
        bank_account_id: account.id,
        failure_reason: result.failureReason ?? null,
      },
    );
  }

  /** Stable pseudo-random cent amounts (1-99) so sandbox flows are reproducible. */
  private pseudoAmount(seed: string, index: number): number {
    let hash = index * 31;
    for (const char of seed) {
      hash = (hash * 33 + char.charCodeAt(0)) % 9973;
    }
    return (hash % 99) + 1;
  }
}
