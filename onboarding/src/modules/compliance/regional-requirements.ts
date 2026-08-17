import { BusinessType } from '@prisma/client';

export interface RegionalProfile {
  /** ISO 3166-1 alpha-2 country code, or `DEFAULT` for the global fallback. */
  country: string;
  regulations: string[];
  screenings: string[];
  taxIdLabel: string;
  businessRegistry: string | null;
  /** Bank fields the settlement account must carry in this region. */
  bankAccountFields: string[];
  dataResidency: string;
}

const DEFAULT_PROFILE: RegionalProfile = {
  country: 'DEFAULT',
  regulations: ['PCI_DSS'],
  screenings: ['sanctions'],
  taxIdLabel: 'tax_id',
  businessRegistry: null,
  bankAccountFields: ['iban'],
  dataResidency: 'global',
};

const PROFILES: Record<string, RegionalProfile> = {
  US: {
    country: 'US',
    regulations: ['PCI_DSS', 'BSA_AML', 'CCPA'],
    screenings: ['ofac', 'sanctions', 'pep'],
    taxIdLabel: 'ein_or_ssn',
    businessRegistry: 'secretary_of_state',
    bankAccountFields: ['routing_number', 'account_number'],
    dataResidency: 'us',
  },
  GB: {
    country: 'GB',
    regulations: ['PCI_DSS', 'FCA', 'PSD2', 'UK_GDPR'],
    screenings: ['hmt_sanctions', 'pep'],
    taxIdLabel: 'company_number',
    businessRegistry: 'companies_house',
    bankAccountFields: ['sort_code', 'account_number'],
    dataResidency: 'uk',
  },
  CA: {
    country: 'CA',
    regulations: ['PCI_DSS', 'PCMLTFA', 'PIPEDA'],
    screenings: ['fintrac', 'sanctions'],
    taxIdLabel: 'business_number',
    businessRegistry: 'corporations_canada',
    bankAccountFields: ['institution_number', 'transit_number', 'account_number'],
    dataResidency: 'ca',
  },
  AU: {
    country: 'AU',
    regulations: ['PCI_DSS', 'AML_CTF', 'PRIVACY_ACT'],
    screenings: ['austrac', 'sanctions'],
    taxIdLabel: 'abn',
    businessRegistry: 'asic',
    bankAccountFields: ['bsb', 'account_number'],
    dataResidency: 'au',
  },
};

const EU_COUNTRIES = ['AT', 'BE', 'DE', 'ES', 'FI', 'FR', 'IE', 'IT', 'NL', 'PT', 'SE'];

for (const country of EU_COUNTRIES) {
  PROFILES[country] = {
    country,
    regulations: ['PCI_DSS', 'GDPR', 'PSD2', 'AMLD5'],
    screenings: ['eu_sanctions', 'pep'],
    taxIdLabel: 'vat_number',
    businessRegistry: 'eu_business_register',
    bankAccountFields: ['iban'],
    dataResidency: 'eu',
  };
}

export function regionalProfile(country: string): RegionalProfile {
  return PROFILES[country.toUpperCase()] ?? { ...DEFAULT_PROFILE, country: country.toUpperCase() };
}

export function isGdprCountry(country: string): boolean {
  const profile = regionalProfile(country);
  return profile.regulations.includes('GDPR') || profile.regulations.includes('UK_GDPR');
}

export const ONBOARDING_STEPS = [
  'business_verification',
  'bank_account_setup',
  'owner_verification',
  'underwriting',
] as const;

export type OnboardingStepName = (typeof ONBOARDING_STEPS)[number];

/**
 * Individuals (sole traders) skip beneficial-owner collection: their identity is
 * verified as part of business verification.
 */
export function requiredSteps(businessType: BusinessType): OnboardingStepName[] {
  return ONBOARDING_STEPS.filter(
    (step) => step !== 'owner_verification' || businessType === BusinessType.company,
  );
}
