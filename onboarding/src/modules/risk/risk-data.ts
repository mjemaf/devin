/**
 * MCC risk bands. Card networks and acquirers treat these categories as elevated
 * because of chargeback frequency, delivery delay, or regulatory exposure.
 */
export const PROHIBITED_MCCS: Record<string, string> = {
  '7995': 'Gambling and betting',
  '6051': 'Quasi-cash and cryptocurrency',
  '5967': 'Adult content',
  '4829': 'Money transfer',
};

export const HIGH_RISK_MCCS: Record<string, string> = {
  '5962': 'Direct marketing - travel',
  '5966': 'Outbound telemarketing',
  '5122': 'Pharmaceuticals',
  '5993': 'Tobacco',
  '7273': 'Dating services',
  '4722': 'Travel agencies',
  '7011': 'Lodging',
  '5816': 'Digital games',
};

export const MODERATE_RISK_MCCS: Record<string, string> = {
  '5734': 'Software',
  '5817': 'Digital goods',
  '5399': 'General merchandise',
  '7372': 'Computer programming services',
};

/** Elevated-jurisdiction weighting derived from FATF listings and AML risk. */
export const COUNTRY_RISK: Record<string, number> = {
  US: 5,
  GB: 5,
  CA: 5,
  AU: 5,
  DE: 5,
  FR: 5,
  IE: 6,
  NL: 6,
  ES: 8,
  IT: 8,
  PL: 10,
  BR: 14,
  MX: 14,
  IN: 14,
  ZA: 16,
  NG: 22,
  PK: 24,
};

export const DEFAULT_COUNTRY_RISK = 12;

export type RiskLevel = 'low' | 'medium' | 'high' | 'prohibited';

export function riskLevelFor(score: number, prohibited: boolean): RiskLevel {
  if (prohibited) {
    return 'prohibited';
  }
  if (score >= 75) {
    return 'high';
  }
  if (score >= 40) {
    return 'medium';
  }
  return 'low';
}
