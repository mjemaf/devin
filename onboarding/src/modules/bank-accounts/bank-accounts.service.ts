import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  BankAccount,
  Prisma,
  StepStatus,
  VerificationMethod,
  VerificationStatus,
} from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ApiException } from '../../common/errors/api.exception';
import { last4, tokenize } from '../../common/crypto.util';
import { newPublicId } from '../../common/ids';
import { AuthContext } from '../../common/auth/auth.types';
import { MerchantsService } from '../merchants/merchants.service';
import { OnboardingStepsService } from '../merchants/onboarding-steps.service';
import { WebhookDispatcherService } from '../webhooks/webhook-dispatcher.service';
import { CreateBankAccountDto } from './dto/create-bank-account.dto';
import { ConfirmMicroDepositsDto } from './dto/confirm-micro-deposits.dto';

@Injectable()
export class BankAccountsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly merchants: MerchantsService,
    private readonly steps: OnboardingStepsService,
    private readonly webhooks: WebhookDispatcherService,
    private readonly config: ConfigService,
  ) {}

  async add(auth: AuthContext, merchantPublicId: string, dto: CreateBankAccountDto) {
    const merchant = await this.merchants.findForPartner(auth, merchantPublicId);
    const existingCount = await this.prisma.bankAccount.count({
      where: { merchantId: merchant.id },
    });
    const method =
      dto.verification_method === 'micro_deposits'
        ? VerificationMethod.micro_deposits
        : VerificationMethod.instant;

    const account = await this.prisma.bankAccount.create({
      data: {
        publicId: newPublicId('ba'),
        merchantId: merchant.id,
        accountNumberLast4: last4(dto.account_number),
        accountNumberToken: tokenize(
          dto.account_number,
          this.config.getOrThrow<string>('jwtSecret'),
        ),
        routingNumber: dto.routing_number,
        accountType: dto.account_type,
        currency: dto.currency.toUpperCase(),
        accountHolderName: dto.account_holder_name,
        verificationMethod: method,
        microDepositAmounts:
          method === VerificationMethod.micro_deposits ? this.generateMicroDeposits() : [],
        isDefault: dto.is_default ?? existingCount === 0,
      },
    });

    if (account.isDefault && existingCount > 0) {
      await this.prisma.bankAccount.updateMany({
        where: { merchantId: merchant.id, id: { not: account.id } },
        data: { isDefault: false },
      });
    }
    await this.steps.setStatus(merchant.id, 'bank_account_setup', StepStatus.in_progress, [
      'verify_bank_account',
    ]);
    return { merchant, account };
  }

  async list(auth: AuthContext, merchantPublicId: string) {
    const merchant = await this.merchants.findForPartner(auth, merchantPublicId);
    return this.prisma.bankAccount.findMany({
      where: { merchantId: merchant.id },
      orderBy: { createdAt: 'asc' },
    });
  }

  async findForMerchant(merchantId: string, publicId: string): Promise<BankAccount> {
    const account = await this.prisma.bankAccount.findFirst({ where: { merchantId, publicId } });
    if (!account) {
      throw ApiException.notFound('bank_account', publicId);
    }
    return account;
  }

  async confirmMicroDeposits(
    auth: AuthContext,
    merchantPublicId: string,
    bankAccountPublicId: string,
    dto: ConfirmMicroDepositsDto,
  ) {
    const merchant = await this.merchants.findForPartner(auth, merchantPublicId);
    const account = await this.findForMerchant(merchant.id, bankAccountPublicId);
    if (account.verificationMethod !== VerificationMethod.micro_deposits) {
      throw ApiException.conflict(
        'Bank account was not enrolled for micro-deposit verification',
        'unsupported_verification_method',
      );
    }
    const expected = [...account.microDepositAmounts].sort((a, b) => a - b);
    const provided = [...dto.amounts].sort((a, b) => a - b);
    const matches =
      expected.length === provided.length && expected.every((amount, i) => amount === provided[i]);

    const updated = await this.prisma.bankAccount.update({
      where: { id: account.id },
      data: {
        verificationStatus: matches ? VerificationStatus.verified : VerificationStatus.failed,
      },
    });
    await this.recordAttempt(merchant.id, account.publicId, matches, dto.amounts);

    if (matches) {
      await this.markSettlementReady(merchant.id, merchant.partnerId, updated);
    }
    return { merchant, account: updated, verified: matches };
  }

  /** Marks the bank step complete once at least one account is verified. */
  async markSettlementReady(
    merchantId: string,
    partnerId: string,
    account: BankAccount,
  ): Promise<void> {
    await this.steps.complete(merchantId, 'bank_account_setup');
    await this.webhooks.emit(partnerId, 'bank_account.verified', {
      bank_account_id: account.publicId,
      account_number_last4: account.accountNumberLast4,
    });
  }

  private async recordAttempt(
    merchantId: string,
    subjectId: string,
    verified: boolean,
    amounts: number[],
  ): Promise<void> {
    await this.prisma.verificationAttempt.create({
      data: {
        publicId: newPublicId('ver'),
        merchantId,
        verificationType: 'bank_account',
        subjectId,
        provider: 'micro_deposits',
        status: verified ? VerificationStatus.verified : VerificationStatus.failed,
        requestData: { amounts } as unknown as Prisma.InputJsonValue,
        errorMessage: verified ? null : 'Micro-deposit amounts did not match',
        completedAt: new Date(),
      },
    });
  }

  private generateMicroDeposits(): number[] {
    return [1 + Math.floor(Math.random() * 98), 1 + Math.floor(Math.random() * 98)];
  }
}
