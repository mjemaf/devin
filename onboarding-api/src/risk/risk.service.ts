import { Injectable } from '@nestjs/common';
import { Prisma, RiskAssessment, RiskLevel, VerificationStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthContext } from '../auth/auth-context';
import { newId } from '../common/ids';
import { MerchantStateService } from '../merchants/merchant-state.service';
import { BusinessProfileJson } from '../merchants/merchant.types';
import { WebhooksService } from '../webhooks/webhooks.service';
import { assessRisk, RiskOutput } from './risk-scoring';

@Injectable()
export class RiskService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly merchantState: MerchantStateService,
    private readonly webhooks: WebhooksService,
    private readonly audit: AuditService,
  ) {}

  async assess(
    auth: AuthContext,
    merchantId: string,
    assessmentType: 'onboarding' | 'ongoing' = 'onboarding',
  ) {
    const merchant = await this.merchantState.findForPartner(auth.partnerId, merchantId);
    const profile = merchant.businessProfile as unknown as BusinessProfileJson;

    const [owners, bankAccounts, attempts] = await Promise.all([
      this.prisma.owner.findMany({ where: { merchantId } }),
      this.prisma.bankAccount.findMany({ where: { merchantId } }),
      this.prisma.verificationAttempt.findMany({ where: { merchantId } }),
    ]);

    const businessAttempts = attempts.filter((attempt) => attempt.verificationType === 'business');
    const output = assessRisk({
      mcc: profile.mcc,
      country: merchant.country,
      estimatedMonthlyVolume: profile.estimated_monthly_volume,
      incorporationDate: profile.incorporation_date,
      website: profile.website,
      businessVerified: businessAttempts.some(
        (attempt) => attempt.status === VerificationStatus.verified,
      ),
      businessVerificationFailed:
        businessAttempts.length > 0 &&
        businessAttempts.every((attempt) => attempt.status === VerificationStatus.failed),
      ownersVerified: owners.filter((owner) => owner.verificationStatus === VerificationStatus.verified)
        .length,
      ownersTotal: owners.length,
      ownershipPercentageCovered: owners.reduce(
        (total, owner) => total + Number(owner.ownershipPercentage),
        0,
      ),
      bankAccountVerified: bankAccounts.some(
        (account) => account.verificationStatus === VerificationStatus.verified,
      ),
      sanctionsHit: attempts.some((attempt) => attempt.errorMessage === 'sanctions_screening_hit'),
    });

    const assessment = await this.prisma.riskAssessment.create({
      data: {
        id: newId('risk'),
        merchantId,
        riskScore: output.riskScore,
        riskLevel: output.riskLevel as RiskLevel,
        factors: output.factors as unknown as Prisma.InputJsonValue,
        recommendations: output.recommendations as unknown as Prisma.InputJsonValue,
        assessmentType,
      },
    });

    await this.audit.record(auth, {
      merchantId,
      action: 'risk.assessed',
      resourceType: 'risk_assessment',
      resourceId: assessment.id,
      changes: { risk_score: output.riskScore, risk_level: output.riskLevel },
    });
    await this.webhooks.publish(merchant.partnerId, 'merchant.risk_assessed', {
      merchant_id: merchantId,
      risk_score: output.riskScore,
      risk_level: output.riskLevel,
    });
    if (output.riskLevel === 'high' || output.riskLevel === 'prohibited') {
      await this.webhooks.publish(merchant.partnerId, 'merchant.risk_flagged', {
        merchant_id: merchantId,
        risk_score: output.riskScore,
        risk_level: output.riskLevel,
        factors: output.factors,
      });
    }

    return this.serialise(assessment, output);
  }

  async latest(auth: AuthContext, merchantId: string): Promise<RiskAssessment | null> {
    await this.merchantState.findForPartner(auth.partnerId, merchantId);
    return this.prisma.riskAssessment.findFirst({
      where: { merchantId },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Returns the newest assessment, scoring the merchant first when none exists yet. */
  async ensureAssessment(auth: AuthContext, merchantId: string): Promise<RiskAssessment> {
    const latest = await this.latest(auth, merchantId);
    if (latest) return latest;
    const created = await this.assess(auth, merchantId, 'onboarding');
    return this.prisma.riskAssessment.findUniqueOrThrow({ where: { id: created.id } });
  }

  async history(auth: AuthContext, merchantId: string) {
    await this.merchantState.findForPartner(auth.partnerId, merchantId);
    const assessments = await this.prisma.riskAssessment.findMany({
      where: { merchantId },
      orderBy: { createdAt: 'desc' },
    });
    return {
      data: assessments.map((assessment) => ({
        id: assessment.id,
        merchant_id: assessment.merchantId,
        risk_score: assessment.riskScore,
        risk_level: assessment.riskLevel,
        factors: assessment.factors,
        recommendations: assessment.recommendations,
        assessment_type: assessment.assessmentType,
        assessed_at: assessment.createdAt,
      })),
    };
  }

  private serialise(assessment: RiskAssessment, output: RiskOutput) {
    return {
      id: assessment.id,
      merchant_id: assessment.merchantId,
      risk_score: output.riskScore,
      risk_level: output.riskLevel,
      factors: output.factors,
      recommendations: output.recommendations,
      assessment_type: assessment.assessmentType,
      assessed_at: assessment.createdAt,
    };
  }
}
