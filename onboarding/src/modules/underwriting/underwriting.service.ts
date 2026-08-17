import { Injectable } from '@nestjs/common';
import {
  AssessmentType,
  Decision,
  MerchantStatus,
  Prisma,
  RiskLevel,
  StepStatus,
  UnderwritingDecision,
  UnderwritingType,
  VerificationStatus,
} from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { newPublicId } from '../../common/ids';
import { AuthContext } from '../../common/auth/auth.types';
import { MerchantsService } from '../merchants/merchants.service';
import { OnboardingStepsService } from '../merchants/onboarding-steps.service';
import { RiskService } from '../risk/risk.service';
import { WebhookDispatcherService } from '../webhooks/webhook-dispatcher.service';
import { WebhookEventType } from '../webhooks/webhook-events';
import { SubmitUnderwritingDto } from './dto/submit-underwriting.dto';
import { UnderwritingResult, underwrite } from './underwriting-engine';

interface BusinessProfileView {
  estimated_monthly_volume: number;
}

const STATUS_BY_DECISION: Record<Decision, MerchantStatus> = {
  approved: MerchantStatus.approved,
  declined: MerchantStatus.declined,
  manual_review: MerchantStatus.under_review,
};

const EVENT_BY_DECISION: Record<Decision, WebhookEventType> = {
  approved: 'merchant.underwriting_approved',
  declined: 'merchant.underwriting_declined',
  manual_review: 'merchant.underwriting_manual_review',
};

@Injectable()
export class UnderwritingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly merchants: MerchantsService,
    private readonly steps: OnboardingStepsService,
    private readonly risk: RiskService,
    private readonly webhooks: WebhookDispatcherService,
  ) {}

  async submit(auth: AuthContext, dto: SubmitUnderwritingDto): Promise<UnderwritingDecision> {
    const merchant = await this.merchants.findForPartner(auth, dto.merchant_id);
    const assessment =
      (await this.risk.latest(merchant.id)) ??
      (await this.risk.assess(auth, merchant.publicId, AssessmentType.onboarding));

    const [owners, bankAccounts, businessVerification, outstandingSteps] = await Promise.all([
      this.prisma.owner.findMany({ where: { merchantId: merchant.id } }),
      this.prisma.bankAccount.findMany({ where: { merchantId: merchant.id } }),
      this.prisma.verificationAttempt.findFirst({
        where: { merchantId: merchant.id, verificationType: 'business' },
        orderBy: { startedAt: 'desc' },
      }),
      this.prisma.onboardingStep.findMany({
        where: {
          merchantId: merchant.id,
          name: { not: 'underwriting' },
          status: { not: StepStatus.completed },
        },
      }),
    ]);

    const profile = merchant.businessProfile as unknown as BusinessProfileView;
    const result =
      dto.underwriting_type === UnderwritingType.manual
        ? this.manualQueueResult(assessment.riskLevel, dto.expedited ?? false)
        : underwrite({
            riskScore: assessment.riskScore,
            riskLevel: assessment.riskLevel,
            estimatedMonthlyVolume: profile.estimated_monthly_volume,
            currency: bankAccounts[0]?.currency ?? 'USD',
            businessVerified: businessVerification?.status === VerificationStatus.verified,
            ownersVerified:
              owners.length === 0 ||
              owners.every((owner) => owner.verificationStatus === VerificationStatus.verified),
            bankAccountVerified: bankAccounts.some(
              (account) => account.verificationStatus === VerificationStatus.verified,
            ),
            outstandingSteps: outstandingSteps.map((step) => step.name),
            expedited: dto.expedited ?? false,
          });

    const decision = await this.persist(
      merchant.id,
      assessment.id,
      dto.underwriting_type ?? UnderwritingType.automated,
      result,
    );

    await this.prisma.merchant.update({
      where: { id: merchant.id },
      data: {
        status: STATUS_BY_DECISION[result.decision],
        processingLimits: result.processingLimits
          ? (result.processingLimits as unknown as Prisma.InputJsonValue)
          : undefined,
      },
    });
    if (result.decision === Decision.approved) {
      await this.steps.complete(merchant.id, 'underwriting');
    } else {
      await this.steps.setStatus(merchant.id, 'underwriting', StepStatus.in_progress, [
        result.decision === Decision.declined ? 'application_declined' : 'await_underwriter_review',
      ]);
    }

    await this.webhooks.emit(merchant.partnerId, EVENT_BY_DECISION[result.decision], {
      merchant_id: merchant.publicId,
      decision: result.decision,
      reason_codes: result.reasonCodes,
      processing_limits: result.processingLimits,
    });
    return decision;
  }

  async latest(auth: AuthContext, merchantPublicId: string): Promise<UnderwritingDecision | null> {
    const merchant = await this.merchants.findForPartner(auth, merchantPublicId);
    return this.prisma.underwritingDecision.findFirst({
      where: { merchantId: merchant.id },
      orderBy: { reviewedAt: 'desc' },
    });
  }

  /** Explicit manual submissions always queue, but keep the risk-derived tier. */
  private manualQueueResult(riskLevel: RiskLevel, expedited: boolean): UnderwritingResult {
    return {
      decision: Decision.manual_review,
      reason: 'Partner requested manual underwriting',
      reasonCodes: ['manual_underwriting_requested'],
      processingLimits: null,
      pricingTier: riskLevel === RiskLevel.high ? 'high_risk' : null,
      validForHours: expedited ? 4 : 24,
    };
  }

  private async persist(
    merchantId: string,
    riskAssessmentId: string,
    underwritingType: UnderwritingType,
    result: UnderwritingResult,
  ): Promise<UnderwritingDecision> {
    return this.prisma.underwritingDecision.create({
      data: {
        publicId: newPublicId('uw'),
        merchantId,
        riskAssessmentId,
        decision: result.decision,
        reason: result.reason,
        reasonCodes: result.reasonCodes,
        processingLimits: result.processingLimits
          ? (result.processingLimits as unknown as Prisma.InputJsonValue)
          : undefined,
        pricingTier: result.pricingTier,
        underwritingType,
        expiresAt:
          result.validForHours === null
            ? null
            : new Date(Date.now() + result.validForHours * 3_600_000),
      },
    });
  }
}
