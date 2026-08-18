import { PROHIBITED_COUNTRIES } from '../compliance/regions';

export type FactorLevel = 'low' | 'medium' | 'high' | 'prohibited';
export type RiskLevelName = 'low' | 'medium' | 'high' | 'prohibited';

export const RISK_FACTORS = [
  'industry_risk',
  'geographic_risk',
  'volume_risk',
  'identity_risk',
  'business_profile_risk',
] as const;

export type RiskFactor = (typeof RISK_FACTORS)[number];

export interface RiskInput {
  mcc: string;
  country: string;
  estimatedMonthlyVolume: number;
  incorporationDate?: string | null;
  website?: string | null;
  businessVerified: boolean;
  businessVerificationFailed: boolean;
  ownersVerified: number;
  ownersTotal: number;
  ownershipPercentageCovered: number;
  bankAccountVerified: boolean;
  sanctionsHit: boolean;
  now?: Date;
}

export interface RiskOutput {
  riskScore: number;
  riskLevel: RiskLevelName;
  factors: Record<RiskFactor, FactorLevel>;
  recommendations: string[];
}

/** MCCs that regulators and card networks treat as elevated risk. */
const HIGH_RISK_MCCS = new Set([
  '7995', // betting / gambling
  '5967', // adult content
  '6051', // quasi-cash, crypto
  '5122', // pharmaceuticals
  '5993', // tobacco
  '7273', // dating services
  '5962', // outbound telemarketing travel
]);

const MEDIUM_RISK_MCCS = new Set([
  '4722', // travel agencies
  '5816', // digital goods / games
  '7311', // advertising services
  '8999', // professional services
  '5399', // general merchandise
]);

const HIGH_RISK_COUNTRIES = new Set(['RU', 'BY', 'VE', 'MM', 'AF', 'NG', 'PK']);
const MEDIUM_RISK_COUNTRIES = new Set(['BR', 'MX', 'TR', 'IN', 'ZA', 'PH', 'ID']);
const LOW_RISK_COUNTRIES = new Set(['US', 'GB', 'CA', 'AU', 'IE', 'DE', 'FR', 'NL', 'SE', 'SG', 'JP', 'NZ']);

const FACTOR_WEIGHTS: Record<RiskFactor, number> = {
  industry_risk: 0.25,
  geographic_risk: 0.2,
  volume_risk: 0.2,
  identity_risk: 0.25,
  business_profile_risk: 0.1,
};

const LEVEL_POINTS: Record<FactorLevel, number> = {
  low: 20,
  medium: 55,
  high: 85,
  prohibited: 100,
};

function industryRisk(mcc: string): FactorLevel {
  if (HIGH_RISK_MCCS.has(mcc)) return 'high';
  if (MEDIUM_RISK_MCCS.has(mcc)) return 'medium';
  return 'low';
}

function geographicRisk(country: string): FactorLevel {
  const code = country.toUpperCase();
  if (PROHIBITED_COUNTRIES.includes(code)) return 'prohibited';
  if (HIGH_RISK_COUNTRIES.has(code)) return 'high';
  if (MEDIUM_RISK_COUNTRIES.has(code)) return 'medium';
  if (LOW_RISK_COUNTRIES.has(code)) return 'low';
  return 'medium';
}

function volumeRisk(estimatedMonthlyVolume: number): FactorLevel {
  if (estimatedMonthlyVolume > 1_000_000) return 'high';
  if (estimatedMonthlyVolume > 100_000) return 'medium';
  return 'low';
}

function identityRisk(input: RiskInput): FactorLevel {
  if (input.sanctionsHit) return 'prohibited';
  if (input.businessVerificationFailed) return 'high';

  const ownersOutstanding = input.ownersTotal === 0 || input.ownersVerified < input.ownersTotal;
  const thinOwnership = input.ownershipPercentageCovered < 75;

  if (!input.businessVerified || (ownersOutstanding && thinOwnership)) return 'high';
  if (ownersOutstanding || thinOwnership || !input.bankAccountVerified) return 'medium';
  return 'low';
}

function businessProfileRisk(input: RiskInput): FactorLevel {
  const now = input.now ?? new Date();
  const ageMonths = input.incorporationDate
    ? (now.getTime() - new Date(input.incorporationDate).getTime()) / (1000 * 60 * 60 * 24 * 30.44)
    : null;

  if (ageMonths === null) return 'medium';
  if (ageMonths < 6) return input.website ? 'medium' : 'high';
  if (ageMonths < 24) return 'medium';
  return 'low';
}

function levelForScore(score: number, factors: Record<RiskFactor, FactorLevel>): RiskLevelName {
  if (Object.values(factors).includes('prohibited')) return 'prohibited';
  if (score < 35) return 'low';
  if (score < 80) return 'medium';
  return 'high';
}

function recommendationsFor(
  score: number,
  level: RiskLevelName,
  factors: Record<RiskFactor, FactorLevel>,
  input: RiskInput,
): string[] {
  const recommendations: string[] = [];

  if (level === 'prohibited') {
    recommendations.push('decline_application');
    return recommendations;
  }
  if (level !== 'low') recommendations.push('enhanced_monitoring');
  if (factors.identity_risk === 'high') recommendations.push('request_additional_identity_documents');
  if (factors.industry_risk === 'high') recommendations.push('require_industry_specific_underwriting');
  if (!input.bankAccountVerified) recommendations.push('require_verified_settlement_account');

  // Cap exposure proportionally to the risk score.
  const capMultiplier = level === 'low' ? 3 : level === 'medium' ? 1.5 : 0.75;
  const monthlyCap = Math.max(5_000, Math.round((input.estimatedMonthlyVolume * capMultiplier) / 1000) * 1000);
  recommendations.push(`transaction_limits:${monthlyCap}`);
  if (score >= 80) recommendations.push('rolling_reserve:10_percent');

  return recommendations;
}

/**
 * Weighted risk score in the 0-100 range where a higher score means higher risk.
 * Thresholds: <35 low, <80 medium, otherwise high; any prohibited factor overrides.
 */
export function assessRisk(input: RiskInput): RiskOutput {
  const factors: Record<RiskFactor, FactorLevel> = {
    industry_risk: industryRisk(input.mcc),
    geographic_risk: geographicRisk(input.country),
    volume_risk: volumeRisk(input.estimatedMonthlyVolume),
    identity_risk: identityRisk(input),
    business_profile_risk: businessProfileRisk(input),
  };

  const riskScore = Math.round(
    RISK_FACTORS.reduce(
      (total, factor) => total + LEVEL_POINTS[factors[factor]] * FACTOR_WEIGHTS[factor],
      0,
    ),
  );
  const riskLevel = levelForScore(riskScore, factors);

  return {
    riskScore,
    riskLevel,
    factors,
    recommendations: recommendationsFor(riskScore, riskLevel, factors, input),
  };
}
