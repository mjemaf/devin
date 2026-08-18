import { Injectable } from '@nestjs/common';
import { MerchantStatus, Prisma } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import { Principal, Scope } from '../../common/auth/principal';
import { SessionTokenService } from '../../common/auth/session-token.service';
import { RequestContext } from '../../common/context/request-context';
import { ApiException } from '../../common/errors/api.exception';
import { PrismaService } from '../../common/prisma/prisma.service';
import { maskTail, sha256 } from '../../common/util/crypto';
import { newReference } from '../../common/util/references';
import { ComplianceService } from '../compliance/compliance.service';
import { WebhookDispatcherService } from '../webhooks/webhook-dispatcher.service';
import { BusinessVerificationDto } from './dto/business-verification.dto';
import { CreateMerchantDto } from './dto/create-merchant.dto';
import { StatusChangeDto, UpdateMerchantDto } from './dto/update-merchant.dto';
import { MerchantStateService } from './merchant-state.service';
import { serializeMerchant } from './merchant.serializer';
import { initialOnboardingState, outstandingActions } from './onboarding-state';

const SESSION_SCOPES: Scope[] = ['merchants:read', 'merchants:write', 'verification:write'];

@Injectable()
export class MerchantsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly compliance: ComplianceService,
    private readonly state: MerchantStateService,
    private readonly audit: AuditService,
    private readonly sessions: SessionTokenService,
    private readonly webhooks: WebhookDispatcherService,
  ) {}

  async create(principal: Principal, dto: CreateMerchantDto, context: RequestContext) {
    const rules = this.compliance.rulesFor(dto.country);
    const steps = this.compliance.requiredSteps(rules.country, dto.business_type);
    const onboarding = initialOnboardingState(steps);

    const merchant = await this.prisma.merchant.create({
      data: {
        reference: newReference('merchant'),
        partnerId: principal.partnerId,
        businessType: dto.business_type,
        country: rules.country,
        locale: dto.locale ?? rules.defaultLocale,
        businessProfile: {
          legal_name: dto.business_name,
          mcc: dto.mcc,
          website: dto.website,
          estimated_monthly_volume: dto.estimated_monthly_volume,
          products_sold: dto.products_sold ?? [],
        } as unknown as Prisma.InputJsonValue,
        contact: { email: dto.email, phone: dto.phone } as unknown as Prisma.InputJsonValue,
        address: (dto.address ?? {}) as unknown as Prisma.InputJsonValue,
        compliance: this.compliance.profileFor(
          rules.country,
          dto.estimated_monthly_volume,
        ) as unknown as Prisma.InputJsonValue,
        onboarding: onboarding as unknown as Prisma.InputJsonValue,
      },
    });

    const session = await this.issueOnboardingToken(principal, merchant.reference);

    await this.audit.record(
      principal,
      {
        action: 'merchant.created',
        resourceType: 'merchant',
        resourceId: merchant.reference,
        merchantId: merchant.id,
        changes: { country: rules.country, business_type: dto.business_type, mcc: dto.mcc },
      },
      context,
    );

    await this.webhooks.emit(principal.partnerId, 'merchant.created', {
      merchant_id: merchant.reference,
      status: merchant.status,
      country: merchant.country,
    });

    return {
      merchant_id: merchant.reference,
      status: merchant.status,
      onboarding_token: session.token,
      onboarding_token_expires_in: session.expiresIn,
      required_steps: steps,
      required_documents: rules.requiredDocuments,
      created_at: merchant.createdAt,
    };
  }

  async get(principal: Principal, reference: string) {
    const merchant = await this.state.require(principal, reference);
    const [owners, bankAccounts, documents, risk, underwriting] = await Promise.all([
      this.prisma.owner.count({ where: { merchantId: merchant.id } }),
      this.prisma.bankAccount.count({ where: { merchantId: merchant.id } }),
      this.prisma.document.count({ where: { merchantId: merchant.id } }),
      this.prisma.riskAssessment.findFirst({
        where: { merchantId: merchant.id },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.underwritingDecision.findFirst({
        where: { merchantId: merchant.id },
        orderBy: { reviewedAt: 'desc' },
      }),
    ]);

    return {
      ...serializeMerchant(merchant),
      counts: { owners, bank_accounts: bankAccounts, documents },
      latest_risk_assessment: risk
        ? { id: risk.reference, risk_score: risk.riskScore, risk_level: risk.riskLevel }
        : null,
      latest_underwriting_decision: underwriting
        ? {
            id: underwriting.reference,
            decision: underwriting.decision,
            pricing_tier: underwriting.pricingTier,
            reviewed_at: underwriting.reviewedAt,
          }
        : null,
    };
  }

  async list(
    principal: Principal,
    query: { status?: MerchantStatus; country?: string; limit: number; cursor?: string },
  ) {
    const merchants = await this.prisma.merchant.findMany({
      where: {
        partnerId: principal.partnerId,
        status: query.status,
        country: query.country?.toUpperCase(),
      },
      orderBy: { createdAt: 'desc' },
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { reference: query.cursor }, skip: 1 } : {}),
    });

    const page = merchants.slice(0, query.limit);
    return {
      data: page.map(serializeMerchant),
      has_more: merchants.length > query.limit,
      next_cursor: merchants.length > query.limit ? page[page.length - 1]?.reference : null,
    };
  }

  async update(
    principal: Principal,
    reference: string,
    dto: UpdateMerchantDto,
    context: RequestContext,
  ) {
    const merchant = await this.state.require(principal, reference);
    const profile = merchant.businessProfile as Record<string, unknown>;
    const contact = merchant.contact as Record<string, unknown>;

    const updated = await this.prisma.merchant.update({
      where: { id: merchant.id },
      data: {
        businessProfile: {
          ...profile,
          ...(dto.mcc ? { mcc: dto.mcc } : {}),
          ...(dto.website ? { website: dto.website } : {}),
          ...(dto.estimated_monthly_volume !== undefined
            ? { estimated_monthly_volume: dto.estimated_monthly_volume }
            : {}),
          ...(dto.products_sold ? { products_sold: dto.products_sold } : {}),
        } as unknown as Prisma.InputJsonValue,
        contact: {
          ...contact,
          ...(dto.email ? { email: dto.email } : {}),
          ...(dto.phone ? { phone: dto.phone } : {}),
        } as unknown as Prisma.InputJsonValue,
        address: dto.address
          ? (dto.address as unknown as Prisma.InputJsonValue)
          : (merchant.address as Prisma.InputJsonValue),
        locale: dto.locale ?? merchant.locale,
        // Repricing inputs changed, so the PCI level has to be recomputed.
        compliance: (dto.estimated_monthly_volume !== undefined
          ? this.compliance.profileFor(merchant.country, dto.estimated_monthly_volume)
          : merchant.compliance) as unknown as Prisma.InputJsonValue,
      },
    });

    await this.audit.record(
      principal,
      {
        action: 'merchant.updated',
        resourceType: 'merchant',
        resourceId: reference,
        merchantId: merchant.id,
        changes: { ...dto },
      },
      context,
    );
    await this.webhooks.emit(principal.partnerId, 'merchant.updated', {
      merchant_id: reference,
      fields: Object.keys(dto),
    });

    return serializeMerchant(updated);
  }

  async submitBusinessVerification(
    principal: Principal,
    reference: string,
    dto: BusinessVerificationDto,
    context: RequestContext,
  ) {
    const merchant = await this.state.require(principal, reference);
    const profile = merchant.businessProfile as Record<string, unknown>;

    await this.prisma.merchant.update({
      where: { id: merchant.id },
      data: {
        businessProfile: {
          ...profile,
          legal_name: dto.legal_name,
          dba_name: dto.dba_name,
          // Only the masked identifier is retained; the raw value is used for the
          // verification call and then discarded.
          tax_id_last4: dto.tax_id.replace(/\D/g, '').slice(-4),
          tax_id_masked: maskTail(dto.tax_id.replace(/\D/g, '')),
          registration_number: dto.registration_number,
          incorporation_date: dto.incorporation_date,
          incorporation_country: dto.incorporation_country ?? merchant.country,
          incorporation_state: dto.incorporation_state,
        } as unknown as Prisma.InputJsonValue,
        address: dto.business_address as unknown as Prisma.InputJsonValue,
      },
    });

    const updated = await this.state.setStepStatus(
      merchant.id,
      'business_verification',
      'in_progress',
      ['run_business_verification'],
    );

    await this.audit.record(
      principal,
      {
        action: 'merchant.business_information_submitted',
        resourceType: 'merchant',
        resourceId: reference,
        merchantId: merchant.id,
        changes: { legal_name: dto.legal_name, registration_number: dto.registration_number },
      },
      context,
    );

    return {
      merchant_id: reference,
      status: updated.status,
      next_actions: ['POST /v1/verify/business'],
      onboarding: this.state.state(updated),
    };
  }

  async status(principal: Principal, reference: string) {
    const merchant = await this.state.require(principal, reference);
    const state = this.state.state(merchant);
    const [verifications, underwriting] = await Promise.all([
      this.prisma.verificationAttempt.findMany({
        where: { merchantId: merchant.id },
        orderBy: { startedAt: 'desc' },
        take: 20,
      }),
      this.prisma.underwritingDecision.findFirst({
        where: { merchantId: merchant.id },
        orderBy: { reviewedAt: 'desc' },
      }),
    ]);

    return {
      merchant_id: merchant.reference,
      overall_status: merchant.status,
      steps: state.steps,
      outstanding_actions: outstandingActions(state),
      verifications: verifications.map((attempt) => ({
        id: attempt.reference,
        type: attempt.verificationType,
        subject: attempt.subjectReference,
        status: attempt.status,
        provider: attempt.provider,
        started_at: attempt.startedAt,
        completed_at: attempt.completedAt,
        error_message: attempt.errorMessage,
      })),
      underwriting: underwriting
        ? {
            decision: underwriting.decision,
            reason: underwriting.reason,
            reason_codes: underwriting.reasonCodes,
            processing_limits: underwriting.processingLimits,
            reviewed_at: underwriting.reviewedAt,
          }
        : null,
      /** Simple SLA projection: automated decisions land within 30 minutes of intake. */
      estimated_completion: this.estimateCompletion(merchant.status, merchant.createdAt),
    };
  }

  async suspend(
    principal: Principal,
    reference: string,
    dto: StatusChangeDto,
    context: RequestContext,
  ) {
    const merchant = await this.state.require(principal, reference);
    if (merchant.status === MerchantStatus.suspended) {
      throw ApiException.conflict('merchant_already_suspended', 'The merchant is already suspended.');
    }

    const updated = await this.state.setStatus(merchant.id, MerchantStatus.suspended, dto.reason);
    await this.audit.record(
      principal,
      {
        action: 'merchant.suspended',
        resourceType: 'merchant',
        resourceId: reference,
        merchantId: merchant.id,
        changes: { reason: dto.reason, previous_status: merchant.status },
      },
      context,
    );
    await this.webhooks.emit(principal.partnerId, 'merchant.suspended', {
      merchant_id: reference,
      reason: dto.reason ?? null,
    });

    return serializeMerchant(updated);
  }

  async activate(principal: Principal, reference: string, context: RequestContext) {
    const merchant = await this.state.require(principal, reference);
    const decision = await this.prisma.underwritingDecision.findFirst({
      where: { merchantId: merchant.id, decision: 'approved' },
      orderBy: { reviewedAt: 'desc' },
    });

    if (!decision) {
      throw ApiException.unprocessable(
        'underwriting_approval_required',
        'A merchant can only be activated after an approved underwriting decision.',
      );
    }

    const updated = await this.state.setStatus(merchant.id, MerchantStatus.active);
    await this.audit.record(
      principal,
      {
        action: 'merchant.activated',
        resourceType: 'merchant',
        resourceId: reference,
        merchantId: merchant.id,
        changes: { previous_status: merchant.status },
      },
      context,
    );
    await this.webhooks.emit(principal.partnerId, 'merchant.activated', {
      merchant_id: reference,
      processing_limits: decision.processingLimits,
    });

    return serializeMerchant(updated);
  }

  /** Mints a merchant-scoped session token for embedded UI / hosted onboarding. */
  async issueOnboardingToken(principal: Principal, reference: string) {
    const merchant = await this.state.require(principal, reference);
    const session = await this.sessions.mint({
      partnerId: merchant.partnerId,
      merchantReference: merchant.reference,
      scopes: SESSION_SCOPES,
      livemode: principal.livemode,
    });

    await this.prisma.onboardingToken.create({
      data: {
        merchantId: merchant.id,
        tokenHash: sha256(session.token),
        expiresAt: new Date(Date.now() + session.expiresIn * 1000),
      },
    });

    return session;
  }

  private estimateCompletion(status: MerchantStatus, createdAt: Date): string | null {
    if (status === MerchantStatus.active || status === MerchantStatus.declined) {
      return null;
    }
    return new Date(createdAt.getTime() + 30 * 60 * 1000).toISOString();
  }
}
