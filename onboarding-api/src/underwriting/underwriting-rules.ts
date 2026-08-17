import { RiskLevelName } from '../risk/risk-scoring';

export type Decision = 'approved' | 'declined' | 'manual_review';
export type PricingTier = 'preferred' | 'standard' | 'elevated_risk';

export interface UnderwritingInput {
  riskScore: number;
  riskLevel: RiskLevelName;
  estimatedMonthlyVolume: number;
  currency: string;
  businessVerified: boolean;
  bankAccountVerified: boolean;
  ownersVerified: boolean;
  sanctionsHit: boolean;
  expedited: boolean;
}

export interface ProcessingLimits {
  daily_limit: number;
  monthly_limit: number;
  ticket_size_limit: number;
  currency: string;
}

export interface UnderwritingOutput {
  decision: Decision;
  reason: string;
  reasonCodes: string[];
  processingLimits: ProcessingLimits | null;
  pricingTier: PricingTier | null;
  /** How long an approval's terms stay valid. */
  expiresInDays: number | null;
}

const VOLUME_MULTIPLIER: Record<RiskLevelName, number> = {
  low: 2,
  medium: 1.25,
  high: 0.75,
  prohibited: 0,
};

const MANUAL_REVIEW_VOLUME_THRESHOLD = 500_000;

function limitsFor(
  riskLevel: RiskLevelName,
  estimatedMonthlyVolume: number,
  currency: string,
): ProcessingLimits {
  const monthly = Math.max(
    5_000,
    Math.round((estimatedMonthlyVolume * VOLUME_MULTIPLIER[riskLevel]) / 1_000) * 1_000,
  );
  const daily = Math.max(1_000, Math.round(monthly / 20 / 100) * 100);
  const ticket = Math.max(500, Math.round(daily / 2 / 100) * 100);

  return {
    daily_limit: daily,
    monthly_limit: monthly,
    ticket_size_limit: ticket,
    currency,
  };
}

function pricingTierFor(riskLevel: RiskLevelName, riskScore: number): PricingTier {
  if (riskLevel === 'low' && riskScore < 25) return 'preferred';
  if (riskLevel === 'high') return 'elevated_risk';
  return 'standard';
}

/**
 * Deterministic underwriting policy. Hard declines come first, then the checks that
 * force a human review, and finally the automated approval with risk-based terms.
 */
export function decideUnderwriting(input: UnderwritingInput): UnderwritingOutput {
  if (input.sanctionsHit || input.riskLevel === 'prohibited') {
    return {
      decision: 'declined',
      reason: 'Merchant failed sanctions or prohibited-jurisdiction screening',
      reasonCodes: input.sanctionsHit ? ['sanctions_screening_hit'] : ['prohibited_jurisdiction'],
      processingLimits: null,
      pricingTier: null,
      expiresInDays: null,
    };
  }

  const blockers: string[] = [];
  if (!input.businessVerified) blockers.push('business_verification_incomplete');
  if (!input.bankAccountVerified) blockers.push('bank_account_unverified');
  if (!input.ownersVerified) blockers.push('owner_verification_incomplete');

  if (blockers.length > 0) {
    return {
      decision: 'manual_review',
      reason: 'One or more verification checks did not complete automatically',
      reasonCodes: blockers,
      processingLimits: null,
      pricingTier: null,
      expiresInDays: null,
    };
  }

  if (input.riskLevel === 'high' || input.estimatedMonthlyVolume > MANUAL_REVIEW_VOLUME_THRESHOLD) {
    return {
      decision: 'manual_review',
      reason:
        input.riskLevel === 'high'
          ? 'Risk score exceeds the automated approval threshold'
          : 'Requested processing volume exceeds the automated approval threshold',
      reasonCodes: input.riskLevel === 'high' ? ['risk_score_above_threshold'] : ['volume_above_threshold'],
      processingLimits: null,
      pricingTier: pricingTierFor(input.riskLevel, input.riskScore),
      expiresInDays: null,
    };
  }

  return {
    decision: 'approved',
    reason: 'All verification checks passed and risk score is within automated approval limits',
    reasonCodes: ['automated_approval'],
    processingLimits: limitsFor(input.riskLevel, input.estimatedMonthlyVolume, input.currency),
    pricingTier: pricingTierFor(input.riskLevel, input.riskScore),
    expiresInDays: input.expedited ? 3 : 7,
  };
}
