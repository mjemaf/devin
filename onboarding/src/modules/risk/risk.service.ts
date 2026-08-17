import { Injectable } from '@nestjs/common';
import { Merchant, Prisma, VerificationStatus } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import { Principal } from '../../common/auth/principal';
import { RequestContext } from '../../common/context/request-context';
import { ApiException } from '../../common/errors/api.exception';
import { PrismaService } from '../../common/prisma/prisma.service';
import { newReference } from '../../common/util/references';
import { MerchantStateService } from '../merchants/merchant-state.service';
import { BusinessProfileShape } from '../merchants/merchant.serializer';
import { WebhookDispatcherService } from '../webhooks/webhook-dispatcher.service';
import {
  COUNTRY_RISK,
  DEFAULT_COUNTRY_RISK,
  HIGH_RISK_MCCS,
  MODERATE_RISK_MCCS,
  PROHIBITED_MCCS,
  RiskLevel,
  riskLevelFor,
} from './risk-data';

export interface RiskFactor {
  name: string;
  score: number;
  weight: number;
  detail: string;
}

export interface RiskOutcome {
  reference: string;
  riskScore: number;
  riskLevel: RiskLevel;
  factors: RiskFactor[];
  recommendations: string[];
  prohibited: boolean;
}

/**
 * Transparent, weighted scoring model. Every factor carries its own sub-score and an
 * explanation so a declined merchant can be given specific, actionable reasons.
 */
@Injectable()
export class RiskService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly state: MerchantStateService,
    private readonly audit: AuditService,
    private readonly webhooks: WebhookDispatcherService,
  ) {}

  async assess(
    principal: Principal,
    reference: string,
    assessmentType: 'onboarding' | 'ongoing',
    context: RequestContext,
  ) {
    const merchant = await this.state.require(principal, reference);
    const outcome = await this.score(merchant);

    const assessment = await this.prisma.riskAssessment.create({
      data: {
        reference: outcome.reference,
        merchantId: merchant.id,
        riskScore: outcome.riskScore,
        riskLevel: outcome.riskLevel,
        factors: outcome.factors as unknown as Prisma.InputJsonValue,
        recommendations: outcome.recommendations as unknown as Prisma.InputJsonValue,
        assessmentType,
      },
    });

    await this.audit.record(
      principal,
      {
        action: 'merchant.risk_assessed',
        resourceType: 'risk_assessment',
        resourceId: assessment.reference,
        merchantId: merchant.id,
        changes: { risk_score: outcome.riskScore, risk_level: outcome.riskLevel, assessmentType },
      },
      context,
    );

    if (outcome.riskLevel === 'high' || outcome.riskLevel === 'prohibited') {
      await this.webhooks.emit(merchant.partnerId, 'merchant.risk_flagged', {
        merchant_id: merchant.reference,
        risk_score: outcome.riskScore,
        risk_level: outcome.riskLevel,
      });
    }

    return this.serialize(merchant, outcome, assessment.createdAt);
  }

  async latest(principal: Principal, reference: string) {
    const merchant = await this.state.require(principal, reference);
    const assessment = await this.prisma.riskAssessment.findFirst({
      where: { merchantId: merchant.id },
      orderBy: { createdAt: 'desc' },
    });
    if (!assessment) {
      throw ApiException.notFound(
        'risk_assessment_not_found',
        'No risk assessment has been run for this merchant yet.',
      );
    }

    return {
      assessment_id: assessment.reference,
      merchant_id: merchant.reference,
      risk_score: assessment.riskScore,
      risk_level: assessment.riskLevel,
      factors: assessment.factors,
      recommendations: assessment.recommendations,
      assessment_type: assessment.assessmentType,
      assessed_at: assessment.createdAt,
    };
  }

  /** Pure scoring pass, reused by the underwriting engine. */
  async score(merchant: Merchant): Promise<RiskOutcome> {
    const profile = merchant.businessProfile as BusinessProfileShape;
    const [owners, bankAccounts, attempts] = await Promise.all([
      this.prisma.owner.findMany({ where: { merchantId: merchant.id } }),
      this.prisma.bankAccount.findMany({ where: { merchantId: merchant.id } }),
      this.prisma.verificationAttempt.findMany({ where: { merchantId: merchant.id } }),
    ]);

    const factors: RiskFactor[] = [];
    const recommendations: string[] = [];
    const mcc = profile.mcc ?? '';
    const prohibited = mcc in PROHIBITED_MCCS;

    if (prohibited) {
      factors.push({
        name: 'prohibited_category',
        score: 100,
        weight: 0.35,
        detail: `${PROHIBITED_MCCS[mcc]} (MCC ${mcc}) is not supported.`,
      });
      recommendations.push('decline_prohibited_category');
    } else if (mcc in HIGH_RISK_MCCS) {
      factors.push({
        name: 'business_category',
        score: 70,
        weight: 0.35,
        detail: `${HIGH_RISK_MCCS[mcc]} (MCC ${mcc}) is an elevated-chargeback category.`,
      });
      recommendations.push('apply_rolling_reserve');
    } else if (mcc in MODERATE_RISK_MCCS) {
      factors.push({
        name: 'business_category',
        score: 35,
        weight: 0.35,
        detail: `${MODERATE_RISK_MCCS[mcc]} (MCC ${mcc}) carries moderate risk.`,
      });
    } else {
      factors.push({
        name: 'business_category',
        score: 15,
        weight: 0.35,
        detail: `MCC ${mcc || 'unknown'} is a standard retail category.`,
      });
    }

    const countryScore = COUNTRY_RISK[merchant.country] ?? DEFAULT_COUNTRY_RISK;
    factors.push({
      name: 'geography',
      score: countryScore,
      weight: 0.1,
      detail: `Jurisdiction ${merchant.country} carries an AML weighting of ${countryScore}.`,
    });

    const volume = profile.estimated_monthly_volume ?? 0;
    const volumeScore = volume > 500_000 ? 65 : volume > 100_000 ? 45 : volume > 10_000 ? 25 : 15;
    factors.push({
      name: 'projected_volume',
      score: volumeScore,
      weight: 0.15,
      detail: `Projected monthly volume of ${volume} in minor units.`,
    });
    if (volumeScore >= 45) {
      recommendations.push('stage_volume_limits');
    }

    const ageMonths = this.businessAgeMonths(profile.incorporation_date);
    const ageScore = ageMonths === null ? 55 : ageMonths >= 36 ? 10 : ageMonths >= 12 ? 30 : 60;
    factors.push({
      name: 'business_tenure',
      score: ageScore,
      weight: 0.1,
      detail:
        ageMonths === null
          ? 'No incorporation date on file.'
          : `Business has been trading for ${ageMonths} months.`,
    });

    const businessVerified = attempts.some(
      (attempt) =>
        attempt.verificationType === 'business' && attempt.status === VerificationStatus.verified,
    );
    const ownersVerified =
      owners.length === 0 ||
      owners.every((owner) => owner.verificationStatus === VerificationStatus.verified);
    const bankVerified = bankAccounts.some(
      (account) => account.verificationStatus === VerificationStatus.verified,
    );
    const verificationScore =
      (businessVerified ? 0 : 40) + (ownersVerified ? 0 : 30) + (bankVerified ? 0 : 30);
    factors.push({
      name: 'verification_completeness',
      score: verificationScore,
      weight: 0.2,
      detail: `business=${businessVerified}, owners=${ownersVerified}, bank=${bankVerified}`,
    });
    if (verificationScore > 0) {
      recommendations.push('complete_outstanding_verifications');
    }

    const screeningHits = attempts.reduce((total, attempt) => {
      const response = attempt.responseData as { screening_hits?: unknown[] } | null;
      return total + (response?.screening_hits?.length ?? 0);
    }, 0);
    factors.push({
      name: 'sanctions_screening',
      score: screeningHits > 0 ? 100 : 0,
      weight: 0.1,
      detail: screeningHits > 0 ? `${screeningHits} screening hit(s) require review.` : 'No screening hits.',
    });
    if (screeningHits > 0) {
      recommendations.push('escalate_sanctions_review');
    }

    if (!profile.website) {
      recommendations.push('collect_website_or_storefront');
    }

    const weighted = factors.reduce((total, factor) => total + factor.score * factor.weight, 0);
    const riskScore = prohibited ? 100 : Math.min(100, Math.round(weighted));

    return {
      reference: newReference('risk'),
      riskScore,
      riskLevel: riskLevelFor(riskScore, prohibited),
      factors,
      recommendations,
      prohibited,
    };
  }

  private serialize(merchant: Merchant, outcome: RiskOutcome, assessedAt: Date) {
    return {
      assessment_id: outcome.reference,
      merchant_id: merchant.reference,
      risk_score: outcome.riskScore,
      risk_level: outcome.riskLevel,
      factors: outcome.factors,
      recommendations: outcome.recommendations,
      assessed_at: assessedAt,
    };
  }

  private businessAgeMonths(incorporationDate?: string): number | null {
    if (!incorporationDate) {
      return null;
    }
    const parsed = new Date(incorporationDate);
    if (Number.isNaN(parsed.getTime())) {
      return null;
    }
    return Math.max(0, Math.floor((Date.now() - parsed.getTime()) / (30 * 24 * 60 * 60 * 1000)));
  }
}
