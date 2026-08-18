export type Region = 'US' | 'UK' | 'EU' | 'CA' | 'APAC' | 'LATAM' | 'OTHER';

export interface RegionalRules {
  country: string;
  region: Region;
  /** Regulatory frameworks applied to merchants in this country. */
  regulations: string[];
  /** Sanctions / watchlists screened during verification. */
  screeningLists: string[];
  /** Registry consulted for KYB, and the label of the registration number. */
  businessRegistry: string;
  registrationNumberLabel: string;
  nationalIdLabel: string;
  /** Beneficial ownership disclosure threshold, in percent. */
  beneficialOwnerThreshold: number;
  bankIdentifierLabel: 'routing_number' | 'sort_code' | 'transit_number' | 'bsb' | 'iban';
  defaultCurrency: string;
  defaultLocale: string;
  /** Where merchant PII must be stored to satisfy local data protection law. */
  dataResidency: string;
  /** Documents that must be on file before underwriting can approve. */
  requiredDocuments: string[];
}

const EU_COUNTRIES = ['DE', 'FR', 'IE', 'NL', 'ES', 'IT', 'BE', 'AT', 'PT', 'FI', 'SE', 'PL'];

const RULES: Record<string, RegionalRules> = {
  US: {
    country: 'US',
    region: 'US',
    regulations: ['BSA/AML', 'PATRIOT Act CIP', 'PCI DSS'],
    screeningLists: ['OFAC SDN', 'OFAC Consolidated'],
    businessRegistry: 'IRS TIN matching + Secretary of State',
    registrationNumberLabel: 'ein',
    nationalIdLabel: 'ssn',
    beneficialOwnerThreshold: 25,
    bankIdentifierLabel: 'routing_number',
    defaultCurrency: 'USD',
    defaultLocale: 'en-US',
    dataResidency: 'us',
    requiredDocuments: ['government_id'],
  },
  GB: {
    country: 'GB',
    region: 'UK',
    regulations: ['FCA', 'PSD2 SCA', 'UK GDPR', 'MLR 2017', 'PCI DSS'],
    screeningLists: ['UK HMT Consolidated', 'UN Consolidated'],
    businessRegistry: 'Companies House',
    registrationNumberLabel: 'company_number',
    nationalIdLabel: 'national_insurance_number',
    beneficialOwnerThreshold: 25,
    bankIdentifierLabel: 'sort_code',
    defaultCurrency: 'GBP',
    defaultLocale: 'en-GB',
    dataResidency: 'uk',
    requiredDocuments: ['government_id', 'proof_of_address'],
  },
  CA: {
    country: 'CA',
    region: 'CA',
    regulations: ['FINTRAC', 'PCMLTFA', 'PIPEDA', 'PCI DSS'],
    screeningLists: ['Canada Consolidated', 'UN Consolidated'],
    businessRegistry: 'Corporations Canada / provincial registries',
    registrationNumberLabel: 'business_number',
    nationalIdLabel: 'sin',
    beneficialOwnerThreshold: 25,
    bankIdentifierLabel: 'transit_number',
    defaultCurrency: 'CAD',
    defaultLocale: 'en-CA',
    dataResidency: 'ca',
    requiredDocuments: ['government_id'],
  },
  AU: {
    country: 'AU',
    region: 'APAC',
    regulations: ['AML/CTF Act', 'AUSTRAC reporting', 'Privacy Act', 'PCI DSS'],
    screeningLists: ['DFAT Consolidated', 'UN Consolidated'],
    businessRegistry: 'ASIC / ABN Lookup',
    registrationNumberLabel: 'abn',
    nationalIdLabel: 'tax_file_number',
    beneficialOwnerThreshold: 25,
    bankIdentifierLabel: 'bsb',
    defaultCurrency: 'AUD',
    defaultLocale: 'en-AU',
    dataResidency: 'au',
    requiredDocuments: ['government_id'],
  },
};

const EU_TEMPLATE = (country: string): RegionalRules => ({
  country,
  region: 'EU',
  regulations: ['AMLD5', 'PSD2 SCA', 'GDPR', 'PCI DSS'],
  screeningLists: ['EU Consolidated', 'UN Consolidated'],
  businessRegistry: 'National business register (BRIS)',
  registrationNumberLabel: 'registration_number',
  nationalIdLabel: 'national_id',
  beneficialOwnerThreshold: 25,
  bankIdentifierLabel: 'iban',
  defaultCurrency: 'EUR',
  defaultLocale: 'en-GB',
  dataResidency: 'eu',
  requiredDocuments: ['government_id', 'proof_of_address'],
});

const FALLBACK = (country: string): RegionalRules => ({
  country,
  region: 'OTHER',
  regulations: ['FATF Recommendations', 'PCI DSS'],
  screeningLists: ['UN Consolidated', 'OFAC SDN'],
  businessRegistry: 'Manual review',
  registrationNumberLabel: 'registration_number',
  nationalIdLabel: 'national_id',
  beneficialOwnerThreshold: 25,
  bankIdentifierLabel: 'iban',
  defaultCurrency: 'USD',
  defaultLocale: 'en-US',
  dataResidency: 'us',
  requiredDocuments: ['government_id', 'proof_of_address', 'bank_statement'],
});

export function rulesForCountry(country: string): RegionalRules {
  const code = country.toUpperCase();
  if (RULES[code]) {
    return RULES[code];
  }
  if (EU_COUNTRIES.includes(code)) {
    return EU_TEMPLATE(code);
  }
  return FALLBACK(code);
}

export const SUPPORTED_COUNTRIES = [...Object.keys(RULES), ...EU_COUNTRIES];
