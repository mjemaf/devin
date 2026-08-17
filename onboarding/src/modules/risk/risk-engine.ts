import { RiskLevel } from '@prisma/client';

export type RiskFactorName =
  | 'industry_risk'
  | 'geographic_risk'
  | 'volume_risk'
  | 'identity_risk'
  | 'document_risk';

export const RISK_FACTORS: RiskFactorName[] = [
  'industry_risk',
  'geographic_risk',
  'volume_risk',
  'identity_risk',
  'document_risk',
];

export interface RiskInput {
  mcc: string;
  country: string;
  estimatedMonthlyVolume: number;
  businessVerified: boolean;
  ownersVerified: boolean;
  bankAccountVerified: boolean;
  ownerCount: number;
  disclosedOwnershipPercentage: number;
  documentCount: number;
  websitePresent: boolean;
}

export interface RiskAssessmentResult {
  /** 0-100 where a higher score means more risk. */
  riskScore: number;
  riskLevel: RiskLevel;
  factors: Record<RiskFactorName, { level: RiskLevel; score: number; reason: string }>;
  recommendations: string[];
}

/** MCCs the platform will not board under any circumstances. */
export const PROHIBITED_MCCS = ['7995', '5967', '6051'];

/** Card-brand / sponsor-bank designated high-risk MCCs. */
export const HIGH_RISK_MCCS = ['4816', '5122', '5912', '5962', '5966', '5993', '7273', '7841'];

const HIGH_RISK_COUNTRIES = ['AF', 'BY', 'CU', 'IR', 'KP', 'MM', 'RU', 'SY', 'VE'];
const ELEVATED_RISK_COUNTRIES = ['BR', 'MX', 'NG', 'PK', 'TR', 'UA', 'ZA'];

const WEIGHTS: Record<RiskFactorName, number> = {
  industry_risk: 0.3,
  geographic_risk: 0.25,
  volume_risk: 0.2,
  identity_risk: 0.15,
  document_risk: 0.1,
};

function levelFor(score: number): RiskLevel {
  if (score >= 85) {
    return RiskLevel.prohibited;
  }
  if (score >= 60) {
    return RiskLevel.high;
  }
  return score >= 30 ? RiskLevel.medium : RiskLevel.low;
}

function industryRisk(mcc: string): { score: number; reason: string } {
  if (PROHIBITED_MCCS.includes(mcc)) {
    return { score: 100, reason: `MCC ${mcc} is on the prohibited list` };
  }
  if (HIGH_RISK_MCCS.includes(mcc)) {
    return { score: 70, reason: `MCC ${mcc} is a card-brand high-risk category` };
  }
  return { score: 15, reason: `MCC ${mcc} is a standard retail category` };
}

function geographicRisk(country: string): { score: number; reason: string } {
  const upper = country.toUpperCase();
  if (HIGH_RISK_COUNTRIES.includes(upper)) {
    return { score: 100, reason: `${upper} is sanctioned or on the FATF call-for-action list` };
  }
  if (ELEVATED_RISK_COUNTRIES.includes(upper)) {
    return { score: 55, reason: `${upper} requires enhanced due diligence` };
  }
  return { score: 10, reason: `${upper} is a low-risk jurisdiction` };
}

function volumeRisk(volume: number): { score: number; reason: string } {
  if (volume > 1_000_000) {
    return { score: 75, reason: 'Projected volume is well above the SMB envelope' };
  }
  if (volume > 250_000) {
    return { score: 45, reason: 'Projected volume is at the top of the SMB envelope' };
  }
  if (volume < 1_000) {
    return { score: 35, reason: 'Projected volume is too small to establish a baseline' };
  }
  return { score: 15, reason: 'Projected volume is typical for an SMB merchant' };
}

function identityRisk(input: RiskInput): { score: number; reason: string } {
  const unverified = [
    !input.businessVerified && 'business',
    !input.ownersVerified && 'owners',
    !input.bankAccountVerified && 'bank_account',
  ].filter((value): value is string => Boolean(value));

  if (unverified.length > 0) {
    return {
      score: Math.min(90, 30 + unverified.length * 20),
      reason: `Unverified: ${unverified.join(', ')}`,
    };
  }
  if (input.ownerCount > 0 && input.disclosedOwnershipPercentage < 75) {
    return { score: 45, reason: 'Less than 75% of beneficial ownership is disclosed' };
  }
  return { score: 10, reason: 'All identity checks passed' };
}

function documentRisk(input: RiskInput): { score: number; reason: string } {
  if (input.documentCount === 0) {
    return { score: 50, reason: 'No supporting documents on file' };
  }
  if (!input.websitePresent) {
    return { score: 30, reason: 'No website to corroborate the stated business activity' };
  }
  return { score: 10, reason: 'Supporting documents and web presence on file' };
}

/**
 * Deterministic, explainable scoring model: each factor is scored 0-100 and
 * combined with fixed weights, with score floors so a single severe signal (a
 * sanctioned country, a high-risk MCC) can never be averaged away.
 */
export function assessRisk(input: RiskInput): RiskAssessmentResult {
  const scored = {
    industry_risk: industryRisk(input.mcc),
    geographic_risk: geographicRisk(input.country),
    volume_risk: volumeRisk(input.estimatedMonthlyVolume),
    identity_risk: identityRisk(input),
    document_risk: documentRisk(input),
  };

  const weighted = RISK_FACTORS.reduce(
    (total, factor) => total + scored[factor].score * WEIGHTS[factor],
    0,
  );
  const worstFactor = Math.max(...RISK_FACTORS.map((factor) => scored[factor].score));
  const floor = worstFactor >= 100 ? 90 : worstFactor >= 60 ? 30 : 0;
  const riskScore = Math.round(Math.max(weighted, floor));

  return {
    riskScore,
    riskLevel: levelFor(riskScore),
    factors: RISK_FACTORS.reduce(
      (factors, factor) => ({
        ...factors,
        [factor]: {
          level: levelFor(scored[factor].score),
          score: scored[factor].score,
          reason: scored[factor].reason,
        },
      }),
      {} as RiskAssessmentResult['factors'],
    ),
    recommendations: recommendationsFor(riskScore, input),
  };
}

function recommendationsFor(riskScore: number, input: RiskInput): string[] {
  const level = levelFor(riskScore);
  if (level === RiskLevel.prohibited) {
    return ['decline_application'];
  }
  const recommendations: string[] = [];
  if (level === RiskLevel.high) {
    recommendations.push('manual_review', 'enhanced_monitoring', 'rolling_reserve:10');
  } else if (level === RiskLevel.medium) {
    recommendations.push('enhanced_monitoring');
  } else {
    recommendations.push('standard_monitoring');
  }
  if (input.documentCount === 0) {
    recommendations.push('request_supporting_documents');
  }
  recommendations.push(`transaction_limits:${suggestedTicketLimit(riskScore, input)}`);
  return recommendations;
}

export function suggestedTicketLimit(riskScore: number, input: RiskInput): number {
  const base = Math.max(1_000, Math.round(input.estimatedMonthlyVolume / 10));
  const multiplier = levelFor(riskScore) === RiskLevel.low ? 1 : levelFor(riskScore) === RiskLevel.medium ? 0.5 : 0.25;
  return Math.round(base * multiplier);
}
