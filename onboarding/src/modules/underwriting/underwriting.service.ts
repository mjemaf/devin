import { Injectable } from '@nestjs/common';
import {
  Merchant,
  MerchantStatus,
  Prisma,
  UnderwritingDecisionType,
  VerificationStatus,
} from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import { Principal } from '../../common/auth/principal';
import { RequestContext } from '../../common/context/request-context';
import { ApiException } from '../../common/errors/api.exception';
import { PrismaService } from '../../common/prisma/prisma.service';
import { newReference } from '../../common/util/references';
import { MerchantStateService } from '../merchants/merchant-state.service';
import { BusinessProfileShape } from '../merchants/merchant.serializer';
import { isOnboardingComplete } from '../merchants/onboarding-state';
import { RiskService } from '../risk/risk.service';
import { WebhookDispatcherService } from '../webhooks/webhook-dispatcher.service';
import { SubmitUnderwritingDto } from './dto/underwriting.dto';
import { limitsFor, pricingTierFor } from './underwriting-policy';

const EVENT_BY_DECISION = {
  approved: 'merchant.underwriting_approved',
  declined: 'merchant.underwriting_declined',
  manual_review: 'merchant.underwriting_manual_review',
} as const;

const STATUS_BY_DECISION: Record<UnderwritingDecisionType, MerchantStatus> = {
  approved: MerchantStatus.approved,
  declined: MerchantStatus.declined,
  manual_review: MerchantStatus.under_review,
};

/**
 * Automated decisioning on top of the risk score. Low risk with complete verification
 * auto-approves; anything ambiguous is routed to a human rather than guessed at.
 */
@Injectable()
export class UnderwritingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly state: MerchantStateService,
    private readonly risk: RiskService,
    private readonly audit: AuditService,
    private readonly webhooks: WebhookDispatcherService,
  ) {}

  async submit(principal: Principal, dto: SubmitUnderwritingDto, context: RequestContext) {
    const merchant = await this.state.require(principal, dto.merchant_id);
    const onboarding = this.state.state(merchant);

    if (!isOnboardingComplete(onboarding) && !dto.allow_incomplete) {
      throw ApiException.unprocessable(
        'onboarding_incomplete',
        'All required onboarding steps must be completed before underwriting.',
      );
    }

    const outcome = await this.risk.score(merchant);
    const assessment = await this.prisma.riskAssessment.create({
      data: {
        reference: outcome.reference,
        merchantId: merchant.id,
        riskScore: outcome.riskScore,
        riskLevel: outcome.riskLevel,
        factors: outcome.factors as unknown as Prisma.InputJsonValue,
        recommendations: outcome.recommendations as unknown as Prisma.InputJsonValue,
        assessmentType: 'onboarding',
      },
    });

    const blockers = await this.blockers(merchant);
    const { decision, reason, reasonCodes } = this.decide(outcome.riskLevel, outcome.riskScore, blockers);
    const volume = (merchant.businessProfile as BusinessProfileShape).estimated_monthly_volume ?? 0;
    const limits = decision === 'approved' ? limitsFor(outcome.riskLevel, volume) : null;
    const pricingTier = decision === 'approved' ? pricingTierFor(outcome.riskLevel) : null;

    const record = await this.prisma.underwritingDecision.create({
      data: {
        reference: newReference('underwriting'),
        merchantId: merchant.id,
        decision,
        reason,
        reasonCodes: reasonCodes as unknown as Prisma.InputJsonValue,
        processingLimits: limits ? (limits as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
        pricingTier,
        underwritingType: 'automated',
        riskAssessmentId: assessment.id,
        // Approvals are revalidated annually as part of ongoing monitoring.
        expiresAt:
          decision === 'approved'
            ? new Date(Date.now() + 365 * 24 * 60 * 60 * 1000)
            : null,
      },
    });

    await this.state.setStatus(merchant.id, STATUS_BY_DECISION[decision], reason);
    if (limits) {
      await this.state.setProcessingLimits(merchant.id, limits);
    }

    await this.audit.record(
      principal,
      {
        action: `merchant.underwriting_${decision}`,
        resourceType: 'underwriting_decision',
        resourceId: record.reference,
        merchantId: merchant.id,
        changes: { risk_score: outcome.riskScore, reason_codes: reasonCodes },
      },
      context,
    );
    await this.webhooks.emit(merchant.partnerId, EVENT_BY_DECISION[decision], {
      merchant_id: merchant.reference,
      decision,
      risk_score: outcome.riskScore,
      processing_limits: limits,
    });

    return this.serialize(merchant, record, outcome.riskScore, outcome.riskLevel);
  }

  async status(principal: Principal, reference: string) {
    const merchant = await this.state.require(principal, reference);
    const decision = await this.prisma.underwritingDecision.findFirst({
      where: { merchantId: merchant.id },
      orderBy: { reviewedAt: 'desc' },
    });

    if (!decision) {
      const onboarding = this.state.state(merchant);
      return {
        merchant_id: merchant.reference,
        decision: null,
        status: merchant.status,
        onboarding_complete: isOnboardingComplete(onboarding),
        blockers: await this.blockers(merchant),
      };
    }

    const assessment = decision.riskAssessmentId
      ? await this.prisma.riskAssessment.findUnique({ where: { id: decision.riskAssessmentId } })
      : null;

    return {
      merchant_id: merchant.reference,
      decision_id: decision.reference,
      decision: decision.decision,
      status: merchant.status,
      reason: decision.reason,
      reason_codes: decision.reasonCodes,
      processing_limits: decision.processingLimits,
      pricing_tier: decision.pricingTier,
      underwriting_type: decision.underwritingType,
      risk_score: assessment?.riskScore ?? null,
      risk_level: assessment?.riskLevel ?? null,
      reviewed_at: decision.reviewedAt,
      expires_at: decision.expiresAt,
    };
  }

  /** Manual override path for the review queue; requires the operator's identity. */
  async decideManually(
    principal: Principal,
    reference: string,
    input: { decision: UnderwritingDecisionType; reason: string; reviewer: string },
    context: RequestContext,
  ) {
    const merchant = await this.state.require(principal, reference);
    const assessment = await this.prisma.riskAssessment.findFirst({
      where: { merchantId: merchant.id },
      orderBy: { createdAt: 'desc' },
    });
    const volume = (merchant.businessProfile as BusinessProfileShape).estimated_monthly_volume ?? 0;
    const limits =
      input.decision === 'approved'
        ? limitsFor((assessment?.riskLevel as 'low' | 'medium' | 'high') ?? 'medium', volume)
        : null;

    const record = await this.prisma.underwritingDecision.create({
      data: {
        reference: newReference('underwriting'),
        merchantId: merchant.id,
        decision: input.decision,
        reason: input.reason,
        reasonCodes: ['manual_review_decision'] as unknown as Prisma.InputJsonValue,
        processingLimits: limits ? (limits as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
        pricingTier:
          input.decision === 'approved'
            ? pricingTierFor((assessment?.riskLevel as 'low' | 'medium' | 'high') ?? 'medium')
            : null,
        underwritingType: 'manual',
        riskAssessmentId: assessment?.id,
        reviewedBy: input.reviewer,
        expiresAt:
          input.decision === 'approved'
            ? new Date(Date.now() + 365 * 24 * 60 * 60 * 1000)
            : null,
      },
    });

    await this.state.setStatus(merchant.id, STATUS_BY_DECISION[input.decision], input.reason);
    if (limits) {
      await this.state.setProcessingLimits(merchant.id, limits);
    }

    await this.audit.record(
      principal,
      {
        action: `merchant.underwriting_${input.decision}`,
        resourceType: 'underwriting_decision',
        resourceId: record.reference,
        merchantId: merchant.id,
        changes: { reviewer: input.reviewer, reason: input.reason, type: 'manual' },
      },
      context,
    );
    await this.webhooks.emit(merchant.partnerId, EVENT_BY_DECISION[input.decision], {
      merchant_id: merchant.reference,
      decision: input.decision,
      processing_limits: limits,
    });

    return this.serialize(
      merchant,
      record,
      assessment?.riskScore ?? null,
      assessment?.riskLevel ?? null,
    );
  }

  private decide(
    riskLevel: string,
    riskScore: number,
    blockers: string[],
  ): { decision: UnderwritingDecisionType; reason: string; reasonCodes: string[] } {
    if (riskLevel === 'prohibited') {
      return {
        decision: UnderwritingDecisionType.declined,
        reason: 'The business category is not supported.',
        reasonCodes: ['prohibited_business_category'],
      };
    }
    if (blockers.length > 0) {
      return {
        decision: UnderwritingDecisionType.manual_review,
        reason: 'Outstanding verification issues need a human review.',
        reasonCodes: blockers,
      };
    }
    if (riskLevel === 'high') {
      return {
        decision: UnderwritingDecisionType.manual_review,
        reason: `Risk score of ${riskScore} exceeds the automated approval threshold.`,
        reasonCodes: ['risk_score_above_threshold'],
      };
    }
    return {
      decision: UnderwritingDecisionType.approved,
      reason: `Risk score of ${riskScore} is within the automated approval threshold.`,
      reasonCodes: ['risk_within_threshold', 'verifications_complete'],
    };
  }

  /** Conditions that must be resolved by a person before an approval is possible. */
  private async blockers(merchant: Merchant): Promise<string[]> {
    const [attempts, owners, bankAccounts] = await Promise.all([
      this.prisma.verificationAttempt.findMany({ where: { merchantId: merchant.id } }),
      this.prisma.owner.findMany({ where: { merchantId: merchant.id } }),
      this.prisma.bankAccount.findMany({ where: { merchantId: merchant.id } }),
    ]);

    const blockers: string[] = [];
    if (
      !attempts.some(
        (attempt) =>
          attempt.verificationType === 'business' && attempt.status === VerificationStatus.verified,
      )
    ) {
      blockers.push('business_verification_incomplete');
    }
    if (
      merchant.businessType === 'company' &&
      (owners.length === 0 ||
        owners.some((owner) => owner.verificationStatus !== VerificationStatus.verified))
    ) {
      blockers.push('owner_verification_incomplete');
    }
    if (
      !bankAccounts.some(
        (account) => account.verificationStatus === VerificationStatus.verified,
      )
    ) {
      blockers.push('bank_account_unverified');
    }
    const hits = attempts.reduce((total, attempt) => {
      const response = attempt.responseData as { screening_hits?: unknown[] } | null;
      return total + (response?.screening_hits?.length ?? 0);
    }, 0);
    if (hits > 0) {
      blockers.push('sanctions_screening_hit');
    }
    return blockers;
  }

  private serialize(
    merchant: Merchant,
    record: { reference: string; decision: UnderwritingDecisionType; reason: string | null; reasonCodes: unknown; processingLimits: unknown; pricingTier: string | null; underwritingType: string; reviewedAt: Date; expiresAt: Date | null },
    riskScore: number | null,
    riskLevel: string | null,
  ) {
    return {
      decision_id: record.reference,
      merchant_id: merchant.reference,
      decision: record.decision,
      reason: record.reason,
      reason_codes: record.reasonCodes,
      processing_limits: record.processingLimits,
      pricing_tier: record.pricingTier,
      underwriting_type: record.underwritingType,
      risk_score: riskScore,
      risk_level: riskLevel,
      reviewed_at: record.reviewedAt,
      expires_at: record.expiresAt,
      next_actions:
        record.decision === UnderwritingDecisionType.approved
          ? [`POST /v1/merchants/${merchant.reference}/activate`]
          : [],
    };
  }
}
