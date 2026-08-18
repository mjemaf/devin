import { Injectable } from '@nestjs/common';
import {
  BusinessType,
  Merchant,
  MerchantStatus,
  Prisma,
  VerificationStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthContext } from '../auth/auth-context';
import { ComplianceService } from '../compliance/compliance.service';
import { isSupportedCountry, PROHIBITED_COUNTRIES } from '../compliance/regions';
import { ApiException } from '../common/errors/api.exception';
import { last4, tokenize } from '../common/crypto.util';
import { newId } from '../common/ids';
import { validateBankAccount } from '../verification/bank-account-validation';
import { VerificationService } from '../verification/verification.service';
import { WebhooksService } from '../webhooks/webhooks.service';
import { CreateBankAccountDto } from './dto/bank-account.dto';
import { SubmitBusinessVerificationDto } from './dto/business-verification.dto';
import { CreateMerchantDto } from './dto/create-merchant.dto';
import { CreateOwnerDto } from './dto/owner.dto';
import { UpdateMerchantDto } from './dto/update-merchant.dto';
import { MerchantStateService } from './merchant-state.service';
import {
  AddressJson,
  BusinessProfileJson,
  ContactJson,
  ProcessingLimitsJson,
} from './merchant.types';
import {
  estimateCompletion,
  buildInitialSteps,
  OnboardingStep,
  pendingStepNames,
} from './onboarding-steps';

const TAX_ID_NAMESPACE = 'merchant_tax_id';
const BANK_ACCOUNT_NAMESPACE = 'bank_account_number';

@Injectable()
export class MerchantsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly merchantState: MerchantStateService,
    private readonly compliance: ComplianceService,
    private readonly verification: VerificationService,
    private readonly webhooks: WebhooksService,
    private readonly audit: AuditService,
  ) {}

  async create(auth: AuthContext, dto: CreateMerchantDto) {
    const country = dto.country.toUpperCase();
    if (PROHIBITED_COUNTRIES.includes(country)) {
      throw ApiException.validation(
        'country_prohibited',
        `Merchants cannot be boarded in ${country}`,
        'country',
      );
    }
    if (!isSupportedCountry(country)) {
      throw ApiException.validation(
        'country_not_supported',
        `${country} is not a supported onboarding country yet`,
        'country',
      );
    }

    const region = this.compliance.region(country);
    const profile: BusinessProfileJson = {
      business_name: dto.business_name,
      legal_name: null,
      dba_name: null,
      tax_id_last4: null,
      tax_id_token: null,
      registration_number: null,
      incorporation_date: null,
      incorporation_country: null,
      incorporation_state: null,
      mcc: dto.mcc,
      website: dto.website ?? null,
      estimated_monthly_volume: dto.estimated_monthly_volume,
      products_sold: dto.products_sold,
    };
    const contact: ContactJson = { email: dto.email, phone: dto.phone };

    const merchant = await this.prisma.merchant.create({
      data: {
        id: newId('merchant'),
        partnerId: auth.partnerId,
        businessType: dto.business_type,
        status: MerchantStatus.pending,
        country,
        businessProfile: profile as unknown as Prisma.InputJsonValue,
        contact: contact as unknown as Prisma.InputJsonValue,
        compliance: this.compliance.profileFor(
          country,
          dto.estimated_monthly_volume,
        ) as unknown as Prisma.InputJsonValue,
        onboardingSteps: buildInitialSteps(
          dto.business_type,
          region,
        ) as unknown as Prisma.InputJsonValue,
      },
    });

    await this.audit.record(auth, {
      merchantId: merchant.id,
      action: 'merchant.created',
      resourceType: 'merchant',
      resourceId: merchant.id,
      changes: { country, business_type: dto.business_type, mcc: dto.mcc },
    });
    await this.webhooks.publish(auth.partnerId, 'merchant.created', {
      merchant_id: merchant.id,
      status: merchant.status,
    });

    return this.serialise(merchant);
  }

  async list(auth: AuthContext, status?: MerchantStatus, limit = 25, cursor?: string) {
    const merchants = await this.prisma.merchant.findMany({
      where: { partnerId: auth.partnerId, ...(status ? { status } : {}) },
      orderBy: { createdAt: 'desc' },
      take: Math.min(limit, 100) + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });

    const page = merchants.slice(0, Math.min(limit, 100));
    return {
      data: page.map((merchant) => this.serialise(merchant)),
      has_more: merchants.length > page.length,
      next_cursor: merchants.length > page.length ? page[page.length - 1].id : null,
    };
  }

  async get(auth: AuthContext, merchantId: string) {
    const merchant = await this.merchantState.findForPartner(auth.partnerId, merchantId);
    return this.serialise(merchant);
  }

  async update(auth: AuthContext, merchantId: string, dto: UpdateMerchantDto) {
    const merchant = await this.merchantState.findForPartner(auth.partnerId, merchantId);
    const profile = this.profile(merchant);
    const contact = merchant.contact as unknown as ContactJson;

    const nextProfile: BusinessProfileJson = {
      ...profile,
      mcc: dto.mcc ?? profile.mcc,
      website: dto.website ?? profile.website ?? null,
      estimated_monthly_volume: dto.estimated_monthly_volume ?? profile.estimated_monthly_volume,
      products_sold: dto.products_sold ?? profile.products_sold,
    };
    const nextContact: ContactJson = {
      email: dto.email ?? contact.email,
      phone: dto.phone ?? contact.phone,
    };

    const updated = await this.prisma.merchant.update({
      where: { id: merchant.id },
      data: {
        businessProfile: nextProfile as unknown as Prisma.InputJsonValue,
        contact: nextContact as unknown as Prisma.InputJsonValue,
        ...(dto.address
          ? { address: this.toAddressJson(dto.address) as unknown as Prisma.InputJsonValue }
          : {}),
        // Volume changes the PCI level, so the compliance snapshot is recomputed.
        compliance: this.compliance.profileFor(
          merchant.country,
          nextProfile.estimated_monthly_volume,
        ) as unknown as Prisma.InputJsonValue,
      },
    });

    await this.audit.record(auth, {
      merchantId: merchant.id,
      action: 'merchant.updated',
      resourceType: 'merchant',
      resourceId: merchant.id,
      changes: { fields: Object.keys(dto) },
    });
    await this.webhooks.publish(auth.partnerId, 'merchant.updated', {
      merchant_id: merchant.id,
      status: updated.status,
    });

    return this.serialise(updated);
  }

  /**
   * Accepts the KYB payload and immediately runs business verification so that a
   * partner gets a synchronous answer in the common (sandbox/instant) case.
   */
  async submitBusinessVerification(
    auth: AuthContext,
    merchantId: string,
    dto: SubmitBusinessVerificationDto,
  ) {
    const merchant = await this.merchantState.findForPartner(auth.partnerId, merchantId);
    const profile = this.profile(merchant);

    const nextProfile: BusinessProfileJson = {
      ...profile,
      legal_name: dto.legal_name,
      dba_name: dto.dba_name ?? null,
      tax_id_last4: last4(dto.tax_id.replace(/\D/g, '')),
      tax_id_token: tokenize(dto.tax_id.replace(/\D/g, ''), TAX_ID_NAMESPACE),
      registration_number: dto.registration_number ?? null,
      incorporation_date: dto.incorporation_date ?? null,
      incorporation_country: dto.incorporation_country ?? merchant.country,
      incorporation_state: dto.incorporation_state ?? null,
    };

    await this.prisma.merchant.update({
      where: { id: merchant.id },
      data: {
        businessProfile: nextProfile as unknown as Prisma.InputJsonValue,
        address: this.toAddressJson(dto.business_address) as unknown as Prisma.InputJsonValue,
      },
    });

    await this.audit.record(auth, {
      merchantId: merchant.id,
      action: 'merchant.business_information_submitted',
      resourceType: 'merchant',
      resourceId: merchant.id,
      // Only non-sensitive fields are auditable; the tax id is never logged.
      changes: { legal_name: dto.legal_name, tax_id_last4: nextProfile.tax_id_last4 },
    });

    return this.verification.verifyBusiness(auth, merchant.id);
  }

  async addOwner(auth: AuthContext, merchantId: string, dto: CreateOwnerDto) {
    const merchant = await this.merchantState.findForPartner(auth.partnerId, merchantId);

    const existing = await this.prisma.owner.aggregate({
      where: { merchantId },
      _sum: { ownershipPercentage: true },
    });
    const total = Number(existing._sum.ownershipPercentage ?? 0) + dto.ownership_percentage;
    if (total > 100) {
      throw ApiException.validation(
        'ownership_percentage_exceeded',
        `Total beneficial ownership across owners cannot exceed 100% (would be ${total}%)`,
        'ownership_percentage',
      );
    }

    const owner = await this.prisma.owner.create({
      data: {
        id: newId('owner'),
        merchantId,
        firstName: dto.first_name,
        lastName: dto.last_name,
        email: dto.email,
        phone: dto.phone ?? null,
        dateOfBirth: new Date(dto.date_of_birth),
        address: this.toAddressJson(dto.address) as unknown as Prisma.InputJsonValue,
        ownershipPercentage: new Prisma.Decimal(dto.ownership_percentage),
        title: dto.title ?? null,
        taxIdLast4: dto.tax_id ? last4(dto.tax_id.replace(/\D/g, '')) : null,
        isControlPerson: dto.is_control_person ?? false,
      },
    });

    await this.merchantState.advanceStep(merchant, 'owner_verification', 'in_progress', [
      'verify_owner_identity',
    ]);
    await this.audit.record(auth, {
      merchantId,
      action: 'merchant.owner_added',
      resourceType: 'owner',
      resourceId: owner.id,
      changes: { ownership_percentage: dto.ownership_percentage, is_control_person: owner.isControlPerson },
    });

    return this.serialiseOwner(owner);
  }

  async listOwners(auth: AuthContext, merchantId: string) {
    await this.merchantState.findForPartner(auth.partnerId, merchantId);
    const owners = await this.prisma.owner.findMany({
      where: { merchantId },
      orderBy: { createdAt: 'asc' },
    });
    return { data: owners.map((owner) => this.serialiseOwner(owner)) };
  }

  /** Stores only a token plus the last four digits, then kicks off verification. */
  async addBankAccount(auth: AuthContext, merchantId: string, dto: CreateBankAccountDto) {
    const merchant = await this.merchantState.findForPartner(auth.partnerId, merchantId);
    const region = this.compliance.region(merchant.country);

    const accountNumber = dto.account_number.replace(/[\s-]/g, '');
    const validation = validateBankAccount(
      region.bankAccountFormat,
      dto.routing_number.replace(/[\s-]/g, ''),
      accountNumber,
    );
    if (!validation.valid) {
      throw ApiException.validation(
        'bank_account_invalid',
        validation.reason ?? `Bank account details are not valid for ${region.displayName}`,
        'account_number',
      );
    }

    const isFirstAccount = (await this.prisma.bankAccount.count({ where: { merchantId } })) === 0;
    const isDefault = dto.is_default ?? isFirstAccount;
    if (isDefault) {
      await this.prisma.bankAccount.updateMany({ where: { merchantId }, data: { isDefault: false } });
    }

    const account = await this.prisma.bankAccount.create({
      data: {
        id: newId('bankAccount'),
        merchantId,
        accountNumberLast4: last4(accountNumber),
        accountNumberToken: tokenize(accountNumber, BANK_ACCOUNT_NAMESPACE),
        routingNumber: dto.routing_number.replace(/[\s-]/g, ''),
        accountType: dto.account_type,
        currency: dto.currency,
        accountHolderName: dto.account_holder_name,
        isDefault,
      },
    });

    await this.audit.record(auth, {
      merchantId,
      action: 'merchant.bank_account_added',
      resourceType: 'bank_account',
      resourceId: account.id,
      changes: { last4: account.accountNumberLast4, currency: account.currency },
    });

    const verification = await this.verification.verifyBankAccount(
      auth,
      merchantId,
      account.id,
      dto.verification_method,
      accountNumber,
    );

    return { ...this.serialiseBankAccount(account), verification };
  }

  async listBankAccounts(auth: AuthContext, merchantId: string) {
    await this.merchantState.findForPartner(auth.partnerId, merchantId);
    const accounts = await this.prisma.bankAccount.findMany({
      where: { merchantId },
      orderBy: { createdAt: 'asc' },
    });
    return { data: accounts.map((account) => this.serialiseBankAccount(account)) };
  }

  async status(auth: AuthContext, merchantId: string) {
    const merchant = await this.merchantState.findForPartner(auth.partnerId, merchantId);
    const steps = this.merchantState.steps(merchant);
    const [risk, underwriting] = await Promise.all([
      this.prisma.riskAssessment.findFirst({
        where: { merchantId },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.underwritingDecision.findFirst({
        where: { merchantId },
        orderBy: { reviewedAt: 'desc' },
      }),
    ]);

    return {
      merchant_id: merchant.id,
      status: merchant.status,
      onboarding_steps: steps,
      pending_steps: pendingStepNames(steps),
      required_actions: steps.flatMap((step) => step.required_actions),
      estimated_completion: estimateCompletion(steps),
      risk: risk ? { level: risk.riskLevel, score: risk.riskScore, assessed_at: risk.createdAt } : null,
      underwriting: underwriting
        ? {
            decision: underwriting.decision,
            reason_codes: underwriting.reasonCodes,
            decided_at: underwriting.reviewedAt,
          }
        : null,
      processing_limits: merchant.processingLimits as unknown as ProcessingLimitsJson | null,
      compliance: merchant.compliance,
    };
  }

  async suspend(auth: AuthContext, merchantId: string, reason: string) {
    const merchant = await this.merchantState.findForPartner(auth.partnerId, merchantId);
    if (merchant.status === MerchantStatus.suspended) {
      throw ApiException.conflict('merchant_already_suspended', 'Merchant is already suspended');
    }

    const updated = await this.merchantState.setStatus(merchant.id, MerchantStatus.suspended);
    await this.audit.record(auth, {
      merchantId,
      action: 'merchant.suspended',
      resourceType: 'merchant',
      resourceId: merchantId,
      changes: { reason, previous_status: merchant.status },
    });
    await this.webhooks.publish(auth.partnerId, 'merchant.suspended', {
      merchant_id: merchantId,
      reason,
    });
    return this.serialise(updated);
  }

  /** Activation is only permitted once underwriting has approved the merchant. */
  async activate(auth: AuthContext, merchantId: string) {
    const merchant = await this.merchantState.findForPartner(auth.partnerId, merchantId);
    if (merchant.status === MerchantStatus.active) return this.serialise(merchant);
    if (merchant.status !== MerchantStatus.approved && merchant.status !== MerchantStatus.suspended) {
      throw ApiException.conflict(
        'merchant_not_approved',
        `A merchant in status '${merchant.status}' cannot be activated`,
      );
    }
    if (merchant.status === MerchantStatus.suspended) {
      const approval = await this.prisma.underwritingDecision.findFirst({
        where: { merchantId, decision: 'approved' },
        orderBy: { reviewedAt: 'desc' },
      });
      if (!approval) {
        throw ApiException.conflict(
          'merchant_not_approved',
          'Merchant has no approved underwriting decision to reinstate',
        );
      }
    }

    const updated = await this.merchantState.setStatus(merchantId, MerchantStatus.active);
    await this.audit.record(auth, {
      merchantId,
      action: 'merchant.activated',
      resourceType: 'merchant',
      resourceId: merchantId,
      changes: { previous_status: merchant.status },
    });
    await this.webhooks.publish(auth.partnerId, 'merchant.activated', { merchant_id: merchantId });
    return this.serialise(updated);
  }

  async auditTrail(auth: AuthContext, merchantId: string) {
    await this.merchantState.findForPartner(auth.partnerId, merchantId);
    const logs = await this.audit.listForMerchant(merchantId);
    return {
      data: logs.map((log) => ({
        id: log.id,
        action: log.action,
        actor_id: log.actorId,
        actor_type: log.actorType,
        resource_type: log.resourceType,
        resource_id: log.resourceId,
        changes: log.changes,
        request_id: log.requestId,
        created_at: log.createdAt,
      })),
    };
  }

  private profile(merchant: Merchant): BusinessProfileJson {
    return merchant.businessProfile as unknown as BusinessProfileJson;
  }

  private toAddressJson(address: {
    line1: string;
    line2?: string;
    city: string;
    state?: string;
    postal_code: string;
    country: string;
  }): AddressJson {
    return {
      line1: address.line1,
      line2: address.line2 ?? null,
      city: address.city,
      state: address.state ?? null,
      postal_code: address.postal_code,
      country: address.country.toUpperCase(),
    };
  }

  private serialise(merchant: Merchant) {
    const profile = this.profile(merchant);
    const steps = (merchant.onboardingSteps as unknown as OnboardingStep[]) ?? [];
    return {
      id: merchant.id,
      object: 'merchant',
      status: merchant.status,
      business_type: merchant.businessType as BusinessType,
      country: merchant.country,
      business_profile: {
        business_name: profile.business_name,
        legal_name: profile.legal_name,
        dba_name: profile.dba_name,
        tax_id_last4: profile.tax_id_last4,
        registration_number: profile.registration_number,
        incorporation_date: profile.incorporation_date,
        incorporation_country: profile.incorporation_country,
        incorporation_state: profile.incorporation_state,
        mcc: profile.mcc,
        website: profile.website,
        estimated_monthly_volume: profile.estimated_monthly_volume,
        products_sold: profile.products_sold,
      },
      contact: merchant.contact,
      address: merchant.address,
      compliance: merchant.compliance,
      processing_limits: merchant.processingLimits,
      onboarding_steps: steps,
      created_at: merchant.createdAt,
      updated_at: merchant.updatedAt,
    };
  }

  private serialiseOwner(owner: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
    phone: string | null;
    dateOfBirth: Date;
    ownershipPercentage: Prisma.Decimal;
    title: string | null;
    taxIdLast4: string | null;
    isControlPerson: boolean;
    verificationStatus: VerificationStatus;
    createdAt: Date;
  }) {
    return {
      id: owner.id,
      object: 'owner',
      first_name: owner.firstName,
      last_name: owner.lastName,
      email: owner.email,
      phone: owner.phone,
      date_of_birth: owner.dateOfBirth.toISOString().slice(0, 10),
      ownership_percentage: Number(owner.ownershipPercentage),
      title: owner.title,
      tax_id_last4: owner.taxIdLast4,
      is_control_person: owner.isControlPerson,
      verification_status: owner.verificationStatus,
      created_at: owner.createdAt,
    };
  }

  private serialiseBankAccount(account: {
    id: string;
    accountNumberLast4: string;
    routingNumber: string;
    accountType: string;
    currency: string;
    accountHolderName: string;
    verificationStatus: VerificationStatus;
    isDefault: boolean;
    createdAt: Date;
  }) {
    return {
      id: account.id,
      object: 'bank_account',
      account_number_last4: account.accountNumberLast4,
      routing_number: account.routingNumber,
      account_type: account.accountType,
      currency: account.currency,
      account_holder_name: account.accountHolderName,
      verification_status: account.verificationStatus,
      is_default: account.isDefault,
      created_at: account.createdAt,
    };
  }
}
