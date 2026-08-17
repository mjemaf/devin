import { Decision, RiskLevel } from '@prisma/client';

export interface ProcessingLimits {
  daily_limit: number;
  monthly_limit: number;
  ticket_size_limit: number;
  currency: string;
}

export interface UnderwritingInput {
  riskScore: number;
  riskLevel: RiskLevel;
  estimatedMonthlyVolume: number;
  currency: string;
  businessVerified: boolean;
  ownersVerified: boolean;
  bankAccountVerified: boolean;
  outstandingSteps: string[];
  expedited: boolean;
}

export interface UnderwritingResult {
  decision: Decision;
  reason: string;
  reasonCodes: string[];
  processingLimits: ProcessingLimits | null;
  pricingTier: string | null;
  /** Hours until the decision must be revisited; null when declined. */
  validForHours: number | null;
}

const VOLUME_MULTIPLIER_BY_LEVEL: Record<RiskLevel, number> = {
  low: 2,
  medium: 1.25,
  high: 0.75,
  prohibited: 0,
};

const PRICING_TIER_BY_LEVEL: Record<RiskLevel, string> = {
  low: 'standard',
  medium: 'standard_plus',
  high: 'high_risk',
  prohibited: 'ineligible',
};

/**
 * Rules-based decisioning: prohibited risk declines outright, unmet verification
 * or elevated risk routes to a human, and everything else is auto-approved with
 * limits derived from projected volume scaled by risk.
 */
export function underwrite(input: UnderwritingInput): UnderwritingResult {
  if (input.riskLevel === RiskLevel.prohibited) {
    return {
      decision: Decision.declined,
      reason: 'Merchant falls outside the platform risk appetite',
      reasonCodes: ['prohibited_risk_profile'],
      processingLimits: null,
      pricingTier: PRICING_TIER_BY_LEVEL.prohibited,
      validForHours: null,
    };
  }

  const blockers: string[] = [];
  if (!input.businessVerified) {
    blockers.push('business_not_verified');
  }
  if (!input.ownersVerified) {
    blockers.push('owners_not_verified');
  }
  if (!input.bankAccountVerified) {
    blockers.push('bank_account_not_verified');
  }
  for (const step of input.outstandingSteps) {
    blockers.push(`step_incomplete:${step}`);
  }

  if (blockers.length > 0) {
    return {
      decision: Decision.manual_review,
      reason: 'Outstanding verification prevents an automated decision',
      reasonCodes: blockers,
      processingLimits: null,
      pricingTier: null,
      validForHours: input.expedited ? 4 : 24,
    };
  }

  if (input.riskLevel === RiskLevel.high) {
    return {
      decision: Decision.manual_review,
      reason: 'Risk score requires underwriter sign-off',
      reasonCodes: ['high_risk_score'],
      processingLimits: null,
      pricingTier: PRICING_TIER_BY_LEVEL.high,
      validForHours: input.expedited ? 4 : 24,
    };
  }

  return {
    decision: Decision.approved,
    reason: 'All verification checks passed',
    reasonCodes: ['automated_approval'],
    processingLimits: limitsFor(input),
    pricingTier: PRICING_TIER_BY_LEVEL[input.riskLevel],
    validForHours: 24 * 7,
  };
}

export function limitsFor(input: UnderwritingInput): ProcessingLimits {
  const monthly = Math.max(
    1_000,
    Math.round(input.estimatedMonthlyVolume * VOLUME_MULTIPLIER_BY_LEVEL[input.riskLevel]),
  );
  return {
    daily_limit: Math.round(monthly / 10),
    monthly_limit: monthly,
    ticket_size_limit: Math.round(monthly / 20),
    currency: input.currency,
  };
}
