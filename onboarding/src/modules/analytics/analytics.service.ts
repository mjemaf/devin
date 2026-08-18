import { Injectable } from '@nestjs/common';
import { MerchantStatus } from '@prisma/client';
import { Principal } from '../../common/auth/principal';
import { PrismaService } from '../../common/prisma/prisma.service';

const FUNNEL_STEPS = [
  'business_verification',
  'owner_verification',
  'bank_account_setup',
  'document_upload',
] as const;

interface StepShape {
  name: string;
  status: string;
}

@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Conversion funnel plus approval and drop-off rates for the calling partner. */
  async onboardingFunnel(principal: Principal, sinceDays: number) {
    const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000);
    const where = this.scope(principal, since);

    const merchants = await this.prisma.merchant.findMany({
      where,
      select: { status: true, country: true, onboarding: true, createdAt: true, activatedAt: true },
    });

    const total = merchants.length;
    const byStatus = merchants.reduce<Record<string, number>>((acc, merchant) => {
      acc[merchant.status] = (acc[merchant.status] ?? 0) + 1;
      return acc;
    }, {});

    const stepCompletion = FUNNEL_STEPS.map((step) => {
      const applicable = merchants.filter((merchant) =>
        this.steps(merchant.onboarding).some((candidate) => candidate.name === step),
      );
      const completed = applicable.filter((merchant) =>
        this.steps(merchant.onboarding).some(
          (candidate) => candidate.name === step && candidate.status === 'completed',
        ),
      );
      return {
        step,
        applicable: applicable.length,
        completed: completed.length,
        completion_rate: rate(completed.length, applicable.length),
      };
    });

    const approved = (byStatus[MerchantStatus.approved] ?? 0) + (byStatus[MerchantStatus.active] ?? 0);
    const decided = approved + (byStatus[MerchantStatus.declined] ?? 0);
    const activated = merchants.filter((merchant) => merchant.activatedAt);
    const activationHours = activated.map(
      (merchant) =>
        ((merchant.activatedAt as Date).getTime() - merchant.createdAt.getTime()) / 3_600_000,
    );

    return {
      period_days: sinceDays,
      total_applications: total,
      by_status: byStatus,
      by_country: merchants.reduce<Record<string, number>>((acc, merchant) => {
        acc[merchant.country] = (acc[merchant.country] ?? 0) + 1;
        return acc;
      }, {}),
      step_completion: stepCompletion,
      approval_rate: rate(approved, decided),
      activation_rate: rate(activated.length, total),
      abandonment_rate: rate(byStatus[MerchantStatus.pending] ?? 0, total),
      median_hours_to_activation: median(activationHours),
    };
  }

  /** Risk mix and automated-versus-manual decision split. */
  async riskMix(principal: Principal, sinceDays: number) {
    const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000);
    const scope = principal.partnerId === 'platform' ? {} : { partnerId: principal.partnerId };

    const [assessments, decisions] = await Promise.all([
      this.prisma.riskAssessment.findMany({
        where: { createdAt: { gte: since }, merchant: scope },
        select: { riskLevel: true, riskScore: true },
      }),
      this.prisma.underwritingDecision.findMany({
        where: { reviewedAt: { gte: since }, merchant: scope },
        select: { decision: true, underwritingType: true, pricingTier: true },
      }),
    ]);

    return {
      period_days: sinceDays,
      assessments: assessments.length,
      by_risk_level: assessments.reduce<Record<string, number>>((acc, assessment) => {
        acc[assessment.riskLevel] = (acc[assessment.riskLevel] ?? 0) + 1;
        return acc;
      }, {}),
      average_risk_score:
        assessments.length === 0
          ? null
          : Math.round(
              assessments.reduce((sum, assessment) => sum + assessment.riskScore, 0) /
                assessments.length,
            ),
      decisions: decisions.length,
      by_decision: decisions.reduce<Record<string, number>>((acc, decision) => {
        acc[decision.decision] = (acc[decision.decision] ?? 0) + 1;
        return acc;
      }, {}),
      automated_share: rate(
        decisions.filter((decision) => decision.underwritingType === 'automated').length,
        decisions.length,
      ),
      by_pricing_tier: decisions.reduce<Record<string, number>>((acc, decision) => {
        if (decision.pricingTier) {
          acc[decision.pricingTier] = (acc[decision.pricingTier] ?? 0) + 1;
        }
        return acc;
      }, {}),
    };
  }

  /** Regulator-facing audit trail export, newest first. */
  async auditTrail(principal: Principal, query: { merchantId?: string; limit: number }) {
    const merchant = query.merchantId
      ? await this.prisma.merchant.findFirst({
          where:
            principal.partnerId === 'platform'
              ? { reference: query.merchantId }
              : { reference: query.merchantId, partnerId: principal.partnerId },
        })
      : null;

    const logs = await this.prisma.auditLog.findMany({
      where: {
        ...(merchant ? { merchantId: merchant.id } : {}),
        ...(principal.partnerId === 'platform'
          ? {}
          : { merchant: { partnerId: principal.partnerId } }),
      },
      orderBy: { createdAt: 'desc' },
      take: query.limit,
    });

    return {
      data: logs.map((log) => ({
        id: log.id,
        action: log.action,
        actor_id: log.actorId,
        actor_type: log.actorType,
        resource_type: log.resourceType,
        resource_id: log.resourceId,
        changes: log.changes,
        ip_address: log.ipAddress,
        request_id: log.requestId,
        created_at: log.createdAt,
      })),
    };
  }

  private scope(principal: Principal, since: Date) {
    return {
      createdAt: { gte: since },
      ...(principal.partnerId === 'platform' ? {} : { partnerId: principal.partnerId }),
    };
  }

  private steps(onboarding: unknown): StepShape[] {
    const state = onboarding as { steps?: StepShape[] } | null;
    return state?.steps ?? [];
  }
}

function rate(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : Math.round((numerator / denominator) * 1000) / 1000;
}

function median(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const value =
    sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
  return Math.round(value * 100) / 100;
}
