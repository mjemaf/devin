import { Inject, Injectable } from '@nestjs/common';
import { BankAccount, Merchant, Owner, Prisma, VerificationStatus } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import { Principal } from '../../common/auth/principal';
import { RequestContext } from '../../common/context/request-context';
import { ApiException } from '../../common/errors/api.exception';
import { PrismaService } from '../../common/prisma/prisma.service';
import { newReference } from '../../common/util/references';
import { ComplianceService } from '../compliance/compliance.service';
import { MerchantStateService } from '../merchants/merchant-state.service';
import {
  BusinessProfileShape,
  serializeBankAccount,
  serializeOwner,
} from '../merchants/merchant.serializer';
import { WebhookDispatcherService } from '../webhooks/webhook-dispatcher.service';
import {
  ConfirmMicroDepositsDto,
  VerifyBankAccountDto,
  VerifyBusinessDto,
  VerifyIdentityDto,
} from './dto/verify.dto';
import {
  BANK_PROVIDER,
  BUSINESS_PROVIDER,
  BankVerificationProvider,
  BusinessVerificationProvider,
  IDENTITY_PROVIDER,
  IdentityVerificationProvider,
  ProviderOutcome,
} from './providers/provider.types';

const OUTCOME_TO_STATUS: Record<ProviderOutcome, VerificationStatus> = {
  verified: VerificationStatus.verified,
  failed: VerificationStatus.failed,
  in_progress: VerificationStatus.in_progress,
};

/**
 * Orchestrates KYB, KYC and bank verification: calls the provider seam, records an
 * immutable attempt, advances the merchant's onboarding step, and emits webhooks.
 */
@Injectable()
export class VerificationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly state: MerchantStateService,
    private readonly compliance: ComplianceService,
    private readonly audit: AuditService,
    private readonly webhooks: WebhookDispatcherService,
    @Inject(BUSINESS_PROVIDER) private readonly businessProvider: BusinessVerificationProvider,
    @Inject(IDENTITY_PROVIDER) private readonly identityProvider: IdentityVerificationProvider,
    @Inject(BANK_PROVIDER) private readonly bankProvider: BankVerificationProvider,
  ) {}

  async verifyBusiness(principal: Principal, dto: VerifyBusinessDto, context: RequestContext) {
    const merchant = await this.state.require(principal, dto.merchant_id);
    const profile = merchant.businessProfile as BusinessProfileShape;

    if (!profile.legal_name || !profile.tax_id_last4) {
      throw ApiException.unprocessable(
        'business_information_required',
        'Submit business information via POST /v1/merchants/{id}/business-verification first.',
      );
    }

    const sources = dto.verification_sources ?? ['government_registry'];
    const result = await this.businessProvider.verifyBusiness({
      merchantReference: merchant.reference,
      country: merchant.country,
      legalName: profile.legal_name,
      dbaName: profile.dba_name,
      registrationNumber: profile.registration_number,
      taxIdLast4: profile.tax_id_last4,
      incorporationDate: profile.incorporation_date,
      address: merchant.address as Record<string, unknown>,
      mcc: profile.mcc ?? '',
      website: profile.website,
      sources,
      priority: dto.priority ?? 'standard',
    });

    const attempt = await this.recordAttempt({
      merchantId: merchant.id,
      verificationType: 'business',
      status: OUTCOME_TO_STATUS[result.outcome],
      provider: result.provider,
      request: { sources, priority: dto.priority ?? 'standard' },
      response: {
        registry_status: result.registryStatus,
        matched_fields: result.matchedFields,
        mismatched_fields: result.mismatchedFields,
        screening_hits: result.screeningHits,
      },
      errorMessage: result.failureReason,
    });

    const updated = await this.state.setStepStatus(
      merchant.id,
      'business_verification',
      result.outcome === 'verified' ? 'completed' : result.outcome === 'failed' ? 'failed' : 'in_progress',
      result.outcome === 'verified' ? [] : ['resolve_business_verification'],
    );

    await this.audit.record(
      principal,
      {
        action: `merchant.business_verification_${result.outcome}`,
        resourceType: 'verification_attempt',
        resourceId: attempt.reference,
        merchantId: merchant.id,
        changes: { provider: result.provider, sources },
      },
      context,
    );
    await this.emitVerificationEvent(merchant, 'business', result.outcome, {
      verification_id: attempt.reference,
      screening_hits: result.screeningHits.length,
      reason: result.failureReason ?? null,
    });

    return {
      verification_id: attempt.reference,
      merchant_id: merchant.reference,
      verification_type: 'business',
      status: attempt.status,
      provider: result.provider,
      registry_status: result.registryStatus,
      matched_fields: result.matchedFields,
      mismatched_fields: result.mismatchedFields,
      screening_hits: result.screeningHits,
      failure_reason: result.failureReason ?? null,
      next_actions: result.outcome === 'verified' ? ['POST /v1/risk/assess'] : [],
      onboarding: this.state.state(updated),
    };
  }

  async verifyIdentity(principal: Principal, dto: VerifyIdentityDto, context: RequestContext) {
    const merchant = await this.state.require(principal, dto.merchant_id);
    const owner = await this.requireOwner(merchant, dto.owner_id);
    const documents = await this.prisma.document.count({
      where: { merchantId: merchant.id, ownerId: owner.id },
    });

    const result = await this.identityProvider.verifyIdentity({
      ownerReference: owner.reference,
      country: merchant.country,
      firstName: owner.firstName,
      lastName: owner.lastName,
      dateOfBirth: owner.dateOfBirth.toISOString().slice(0, 10),
      address: owner.address as Record<string, unknown>,
      nationalIdLast4: owner.nationalIdLast4 ?? undefined,
      method: dto.verification_method,
      hasIdDocument: documents > 0,
    });

    const status = OUTCOME_TO_STATUS[result.outcome];
    const updatedOwner = await this.prisma.owner.update({
      where: { id: owner.id },
      data: { verificationStatus: status },
    });

    const attempt = await this.recordAttempt({
      merchantId: merchant.id,
      verificationType: 'identity',
      subjectReference: owner.reference,
      status,
      provider: result.provider,
      request: { verification_method: dto.verification_method, consent: dto.consent },
      response: { checks: result.checks, screening_hits: result.screeningHits },
      errorMessage: result.failureReason,
    });

    const updated = await this.refreshOwnerStep(merchant);

    await this.audit.record(
      principal,
      {
        action: `owner.identity_verification_${result.outcome}`,
        resourceType: 'verification_attempt',
        resourceId: attempt.reference,
        merchantId: merchant.id,
        changes: { owner_id: owner.reference, method: dto.verification_method },
      },
      context,
    );
    await this.emitVerificationEvent(merchant, 'identity', result.outcome, {
      verification_id: attempt.reference,
      owner_id: owner.reference,
      reason: result.failureReason ?? null,
    });

    return {
      verification_id: attempt.reference,
      merchant_id: merchant.reference,
      verification_type: 'identity',
      status: attempt.status,
      provider: result.provider,
      checks: result.checks,
      screening_hits: result.screeningHits,
      failure_reason: result.failureReason ?? null,
      owner: serializeOwner(updatedOwner),
      onboarding: this.state.state(updated),
    };
  }

  async verifyBankAccount(principal: Principal, dto: VerifyBankAccountDto, context: RequestContext) {
    const merchant = await this.state.require(principal, dto.merchant_id);
    const account = await this.requireBankAccount(merchant, dto.bank_account_id);
    const profile = merchant.businessProfile as BusinessProfileShape;
    const method = dto.verification_method ?? (account.verificationMethod as 'instant' | 'micro_deposits') ?? 'instant';

    const result = await this.bankProvider.verifyBankAccount({
      bankAccountReference: account.reference,
      country: account.country,
      accountNumberLast4: account.accountNumberLast4,
      routingNumber: account.routingNumber,
      accountHolderName: account.accountHolderName,
      merchantLegalName: profile.legal_name ?? account.accountHolderName,
      method,
    });

    const status = OUTCOME_TO_STATUS[result.outcome];
    const updatedAccount = await this.prisma.bankAccount.update({
      where: { id: account.id },
      data: {
        verificationStatus: status,
        verificationMethod: method,
        microDeposits: result.microDeposits
          ? (result.microDeposits as unknown as Prisma.InputJsonValue)
          : Prisma.DbNull,
      },
    });

    const attempt = await this.recordAttempt({
      merchantId: merchant.id,
      verificationType: 'bank_account',
      subjectReference: account.reference,
      status,
      provider: result.provider,
      request: { verification_method: method },
      response: {
        account_holder_match: result.accountHolderMatch,
        account_status: result.accountStatus,
        // Deposit amounts are deliberately not echoed back; the partner must confirm them.
        micro_deposits_sent: Boolean(result.microDeposits),
      },
      errorMessage: result.failureReason,
    });

    const updated = await this.refreshBankStep(merchant);

    await this.audit.record(
      principal,
      {
        action: `bank_account.verification_${result.outcome}`,
        resourceType: 'verification_attempt',
        resourceId: attempt.reference,
        merchantId: merchant.id,
        changes: { bank_account_id: account.reference, method },
      },
      context,
    );

    if (result.outcome === 'verified') {
      await this.webhooks.emit(merchant.partnerId, 'bank_account.verified', {
        merchant_id: merchant.reference,
        bank_account_id: account.reference,
      });
    } else if (result.outcome === 'failed') {
      await this.webhooks.emit(merchant.partnerId, 'bank_account.verification_failed', {
        merchant_id: merchant.reference,
        bank_account_id: account.reference,
        reason: result.failureReason ?? null,
      });
    }

    return {
      verification_id: attempt.reference,
      merchant_id: merchant.reference,
      verification_type: 'bank_account',
      status: attempt.status,
      provider: result.provider,
      verification_method: method,
      account_holder_match: result.accountHolderMatch,
      account_status: result.accountStatus,
      micro_deposits_sent: Boolean(result.microDeposits),
      failure_reason: result.failureReason ?? null,
      next_actions:
        result.outcome === 'in_progress' ? ['POST /v1/verify/bank-account/confirm'] : [],
      bank_account: serializeBankAccount(updatedAccount),
      onboarding: this.state.state(updated),
    };
  }

  /** Completes a micro-deposit flow by matching the amounts the merchant saw. */
  async confirmMicroDeposits(
    principal: Principal,
    dto: ConfirmMicroDepositsDto,
    context: RequestContext,
  ) {
    const merchant = await this.state.require(principal, dto.merchant_id);
    const account = await this.requireBankAccount(merchant, dto.bank_account_id);
    const expected = (account.microDeposits as number[] | null) ?? null;

    if (!expected) {
      throw ApiException.unprocessable(
        'no_micro_deposits_pending',
        'No micro-deposit verification is open for this bank account.',
      );
    }

    const matches =
      expected.length === dto.amounts.length &&
      [...expected].sort().join(',') === [...dto.amounts].sort().join(',');

    const updatedAccount = await this.prisma.bankAccount.update({
      where: { id: account.id },
      data: {
        verificationStatus: matches ? VerificationStatus.verified : VerificationStatus.failed,
        microDeposits: matches ? Prisma.DbNull : (expected as unknown as Prisma.InputJsonValue),
      },
    });

    const attempt = await this.recordAttempt({
      merchantId: merchant.id,
      verificationType: 'bank_account',
      subjectReference: account.reference,
      status: matches ? VerificationStatus.verified : VerificationStatus.failed,
      provider: 'micro_deposit_confirmation',
      request: { amount_count: dto.amounts.length },
      response: { matched: matches },
      errorMessage: matches ? undefined : 'The confirmed amounts did not match the deposits sent.',
    });

    const updated = await this.refreshBankStep(merchant);

    await this.audit.record(
      principal,
      {
        action: matches ? 'bank_account.verification_verified' : 'bank_account.verification_failed',
        resourceType: 'verification_attempt',
        resourceId: attempt.reference,
        merchantId: merchant.id,
        changes: { bank_account_id: account.reference },
      },
      context,
    );
    await this.webhooks.emit(
      merchant.partnerId,
      matches ? 'bank_account.verified' : 'bank_account.verification_failed',
      { merchant_id: merchant.reference, bank_account_id: account.reference },
    );

    return {
      verification_id: attempt.reference,
      merchant_id: merchant.reference,
      status: attempt.status,
      bank_account: serializeBankAccount(updatedAccount),
      onboarding: this.state.state(updated),
    };
  }

  async listAttempts(principal: Principal, reference: string) {
    const merchant = await this.state.require(principal, reference);
    const attempts = await this.prisma.verificationAttempt.findMany({
      where: { merchantId: merchant.id },
      orderBy: { startedAt: 'desc' },
    });

    return {
      data: attempts.map((attempt) => ({
        id: attempt.reference,
        verification_type: attempt.verificationType,
        subject: attempt.subjectReference,
        status: attempt.status,
        provider: attempt.provider,
        response: attempt.responseData,
        failure_reason: attempt.errorMessage,
        started_at: attempt.startedAt,
        completed_at: attempt.completedAt,
      })),
    };
  }

  private async recordAttempt(input: {
    merchantId: string;
    verificationType: string;
    subjectReference?: string;
    status: VerificationStatus;
    provider: string;
    request: Record<string, unknown>;
    response: Record<string, unknown>;
    errorMessage?: string;
  }) {
    return this.prisma.verificationAttempt.create({
      data: {
        reference: newReference('verification'),
        merchantId: input.merchantId,
        verificationType: input.verificationType,
        subjectReference: input.subjectReference,
        status: input.status,
        provider: input.provider,
        requestData: input.request as unknown as Prisma.InputJsonValue,
        responseData: input.response as unknown as Prisma.InputJsonValue,
        errorMessage: input.errorMessage,
        completedAt: input.status === VerificationStatus.in_progress ? null : new Date(),
      },
    });
  }

  private async requireOwner(merchant: Merchant, ownerReference: string): Promise<Owner> {
    const owner = await this.prisma.owner.findFirst({
      where: { reference: ownerReference, merchantId: merchant.id },
    });
    if (!owner) {
      throw ApiException.notFound(
        'owner_not_found',
        `No owner ${ownerReference} on merchant ${merchant.reference}.`,
      );
    }
    return owner;
  }

  private async requireBankAccount(
    merchant: Merchant,
    accountReference: string,
  ): Promise<BankAccount> {
    const account = await this.prisma.bankAccount.findFirst({
      where: { reference: accountReference, merchantId: merchant.id },
    });
    if (!account) {
      throw ApiException.notFound(
        'bank_account_not_found',
        `No bank account ${accountReference} on merchant ${merchant.reference}.`,
      );
    }
    return account;
  }

  /** Owner step closes once every owner above the regional threshold is verified. */
  private async refreshOwnerStep(merchant: Merchant) {
    const rules = this.compliance.rulesFor(merchant.country);
    const owners = await this.prisma.owner.findMany({ where: { merchantId: merchant.id } });
    const disclosed = owners.filter(
      (owner) => Number(owner.ownershipPercentage) >= rules.beneficialOwnerThreshold,
    );
    const pending = [
      ...(owners.some((owner) => owner.isControlProng) ? [] : ['designate_control_prong']),
      ...disclosed
        .filter((owner) => owner.verificationStatus !== VerificationStatus.verified)
        .map((owner) => `verify_identity:${owner.reference}`),
    ];

    return this.state.setStepStatus(
      merchant.id,
      'owner_verification',
      pending.length === 0 && owners.length > 0 ? 'completed' : 'in_progress',
      pending,
    );
  }

  private async refreshBankStep(merchant: Merchant) {
    const accounts = await this.prisma.bankAccount.findMany({
      where: { merchantId: merchant.id },
    });
    const verified = accounts.some(
      (account) => account.verificationStatus === VerificationStatus.verified,
    );

    return this.state.setStepStatus(
      merchant.id,
      'bank_account_setup',
      verified ? 'completed' : 'in_progress',
      verified ? [] : accounts.map((account) => `verify_bank_account:${account.reference}`),
    );
  }

  private async emitVerificationEvent(
    merchant: Merchant,
    type: string,
    outcome: ProviderOutcome,
    data: Record<string, unknown>,
  ): Promise<void> {
    if (outcome === 'in_progress') {
      return;
    }
    await this.webhooks.emit(
      merchant.partnerId,
      outcome === 'verified' ? 'merchant.verification_completed' : 'merchant.verification_failed',
      { merchant_id: merchant.reference, verification_type: type, ...data },
    );
  }
}
