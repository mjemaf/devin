import { Injectable } from '@nestjs/common';
import {
  MerchantStatus,
  Prisma,
  UnderwritingDecision,
  UnderwritingDecisionType,
  VerificationStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthContext } from '../auth/auth-context';
import { ApiException } from '../common/errors/api.exception';
import { newId } from '../common/ids';
import { ComplianceService } from '../compliance/compliance.service';
import { MerchantStateService } from '../merchants/merchant-state.service';
import { BusinessProfileJson } from '../merchants/merchant.types';
import { pendingStepNames } from '../merchants/onboarding-steps';
import { RiskLevelName } from '../risk/risk-scoring';
import { RiskService } from '../risk/risk.service';
import { WebhooksService } from '../webhooks/webhooks.service';
import { decideUnderwriting, UnderwritingOutput } from './underwriting-rules';

const STATUS_BY_DECISION: Record<UnderwritingDecisionType, MerchantStatus> = {
  approved: MerchantStatus.approved,
  declined: MerchantStatus.declined,
  manual_review: MerchantStatus.under_review,
};

const EVENT_BY_DECISION = {
  approved: 'merchant.underwriting_approved',
  declined: 'merchant.underwriting_declined',
  manual_review: 'merchant.underwriting_manual_review',
} as const;

@Injectable()
export class UnderwritingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly merchantState: MerchantStateService,
    private readonly risk: RiskService,
    private readonly compliance: ComplianceService,
    private readonly webhooks: WebhooksService,
    private readonly audit: AuditService,
  ) {}

  async submit(
    auth: AuthContext,
    merchantId: string,
    underwritingType: 'automated' | 'manual' = 'automated',
    expedited = false,
  ) {
    const merchant = await this.merchantState.findForPartner(auth.partnerId, merchantId);
    if (merchant.status === MerchantStatus.suspended) {
      throw ApiException.conflict(
        'merchant_suspended',
        'A suspended merchant cannot be submitted for underwriting',
      );
    }

    const profile = merchant.businessProfile as unknown as BusinessProfileJson;
    const [owners, bankAccounts, attempts] = await Promise.all([
      this.prisma.owner.findMany({ where: { merchantId } }),
      this.prisma.bankAccount.findMany({ where: { merchantId } }),
      this.prisma.verificationAttempt.findMany({ where: { merchantId } }),
    ]);
    const sanctionsHit = attempts.some(
      (attempt) => attempt.errorMessage === 'sanctions_screening_hit',
    );

    const outstanding = pendingStepNames(this.merchantState.steps(merchant)).filter(
      (step) => step !== 'manual_compliance_review',
    );
    // A screening hit is decided immediately: its onboarding steps can never complete.
    if (underwritingType === 'automated' && !sanctionsHit && outstanding.length > 0) {
      throw ApiException.conflict(
        'onboarding_incomplete',
        `Complete the outstanding onboarding steps before automated underwriting: ${outstanding.join(', ')}`,
      );
    }

    // Underwriting always decides against a risk assessment.
    const assessment = await this.risk.ensureAssessment(auth, merchantId);

    const output = decideUnderwriting({
      riskScore: assessment.riskScore,
      riskLevel: assessment.riskLevel as RiskLevelName,
      estimatedMonthlyVolume: profile.estimated_monthly_volume,
      currency: this.compliance.region(merchant.country).defaultCurrency,
      businessVerified: attempts.some(
        (attempt) =>
          attempt.verificationType === 'business' && attempt.status === VerificationStatus.verified,
      ),
      bankAccountVerified: bankAccounts.some(
        (account) => account.verificationStatus === VerificationStatus.verified,
      ),
      ownersVerified:
        owners.length > 0 &&
        owners.every((owner) => owner.verificationStatus === VerificationStatus.verified),
      sanctionsHit,
      expedited,
    });

    const decision = await this.prisma.underwritingDecision.create({
      data: {
        id: newId('underwriting'),
        merchantId,
        decision: output.decision as UnderwritingDecisionType,
        reason: output.reason,
        reasonCodes: output.reasonCodes,
        processingLimits: (output.processingLimits ?? undefined) as unknown as Prisma.InputJsonValue,
        pricingTier: output.pricingTier,
        underwritingType,
        riskAssessmentId: assessment.id,
        expiresAt: output.expiresInDays
          ? new Date(Date.now() + output.expiresInDays * 86_400_000)
          : null,
      },
    });

    await this.prisma.merchant.update({
      where: { id: merchantId },
      data: {
        status: STATUS_BY_DECISION[decision.decision],
        processingLimits: (output.processingLimits ?? undefined) as unknown as Prisma.InputJsonValue,
      },
    });

    await this.audit.record(auth, {
      merchantId,
      action: 'underwriting.decision',
      resourceType: 'underwriting_decision',
      resourceId: decision.id,
      changes: { decision: output.decision, reason_codes: output.reasonCodes },
    });
    await this.webhooks.publish(merchant.partnerId, EVENT_BY_DECISION[output.decision], {
      merchant_id: merchantId,
      decision: output.decision,
      reason: output.reason,
      processing_limits: output.processingLimits,
      timestamp: new Date().toISOString(),
    });

    return this.serialise(decision, output);
  }

  async status(auth: AuthContext, merchantId: string) {
    await this.merchantState.findForPartner(auth.partnerId, merchantId);
    const decision = await this.prisma.underwritingDecision.findFirst({
      where: { merchantId },
      orderBy: { reviewedAt: 'desc' },
    });
    if (!decision) {
      return { merchant_id: merchantId, decision: null, status: 'not_submitted' };
    }
    return {
      merchant_id: merchantId,
      decision: decision.decision,
      reason: decision.reason,
      reason_codes: decision.reasonCodes,
      processing_limits: decision.processingLimits,
      pricing_tier: decision.pricingTier,
      underwriting_type: decision.underwritingType,
      reviewed_at: decision.reviewedAt,
      expires_at: decision.expiresAt,
    };
  }

  /** Records a human decision, used when automated underwriting routed to review. */
  async recordManualDecision(
    auth: AuthContext,
    merchantId: string,
    decisionType: 'approved' | 'declined',
    reason: string,
    limits?: { daily_limit: number; monthly_limit: number; ticket_size_limit: number },
  ) {
    const merchant = await this.merchantState.findForPartner(auth.partnerId, merchantId);
    const processingLimits = limits
      ? { ...limits, currency: this.compliance.region(merchant.country).defaultCurrency }
      : undefined;
    const decision = await this.prisma.underwritingDecision.create({
      data: {
        id: newId('underwriting'),
        merchantId,
        decision: decisionType as UnderwritingDecisionType,
        reason,
        reasonCodes: ['manual_decision'],
        processingLimits: (processingLimits ?? undefined) as unknown as Prisma.InputJsonValue,
        underwritingType: 'manual',
        reviewedBy: auth.actorId,
      },
    });

    await this.prisma.merchant.update({
      where: { id: merchantId },
      data: {
        status: STATUS_BY_DECISION[decision.decision],
        ...(processingLimits
          ? { processingLimits: processingLimits as unknown as Prisma.InputJsonValue }
          : {}),
      },
    });
    await this.audit.record(auth, {
      merchantId,
      action: 'underwriting.manual_decision',
      resourceType: 'underwriting_decision',
      resourceId: decision.id,
      changes: { decision: decisionType, reason },
    });
    await this.webhooks.publish(merchant.partnerId, EVENT_BY_DECISION[decisionType], {
      merchant_id: merchantId,
      decision: decisionType,
      reason,
      processing_limits: processingLimits ?? null,
      timestamp: new Date().toISOString(),
    });

    return {
      merchant_id: merchantId,
      decision: decision.decision,
      reason: decision.reason,
      processing_limits: decision.processingLimits,
      reviewed_by: decision.reviewedBy,
      reviewed_at: decision.reviewedAt,
    };
  }

  private serialise(decision: UnderwritingDecision, output: UnderwritingOutput) {
    return {
      id: decision.id,
      merchant_id: decision.merchantId,
      decision: output.decision,
      reason: output.reason,
      reason_codes: output.reasonCodes,
      processing_limits: output.processingLimits,
      pricing_tier: output.pricingTier,
      underwriting_type: decision.underwritingType,
      reviewed_at: decision.reviewedAt,
      expires_at: decision.expiresAt,
    };
  }
}
