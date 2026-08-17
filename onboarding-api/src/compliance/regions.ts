export type BankAccountFormat = 'us_aba' | 'uk_sort_code' | 'iban' | 'ca_transit' | 'au_bsb';

export interface RegionProfile {
  country: string;
  displayName: string;
  defaultCurrency: string;
  /** Frameworks a merchant in this country is boarded under. */
  regulations: string[];
  /** Screening lists that must clear before underwriting. */
  screeningLists: string[];
  /** Registries used for automated business verification. */
  businessRegistries: string[];
  bankAccountFormat: BankAccountFormat;
  /** Extra onboarding steps beyond the global baseline. */
  additionalSteps: string[];
  gdprApplies: boolean;
  taxIdLabel: string;
}

const REGIONS: Record<string, RegionProfile> = {
  US: {
    country: 'US',
    displayName: 'United States',
    defaultCurrency: 'USD',
    regulations: ['BSA_AML', 'PCI_DSS', 'CCPA'],
    screeningLists: ['OFAC_SDN', 'OFAC_CONSOLIDATED'],
    businessRegistries: ['IRS_TIN_MATCH', 'SECRETARY_OF_STATE'],
    bankAccountFormat: 'us_aba',
    additionalSteps: ['tax_id_verification'],
    gdprApplies: false,
    taxIdLabel: 'EIN/SSN',
  },
  GB: {
    country: 'GB',
    displayName: 'United Kingdom',
    defaultCurrency: 'GBP',
    regulations: ['FCA', 'PSD2', 'UK_GDPR', 'PCI_DSS', 'MLR_2017'],
    screeningLists: ['UK_HMT_SANCTIONS', 'EU_CONSOLIDATED'],
    businessRegistries: ['COMPANIES_HOUSE'],
    bankAccountFormat: 'uk_sort_code',
    additionalSteps: ['psd2_sca_attestation'],
    gdprApplies: true,
    taxIdLabel: 'Company registration number',
  },
  CA: {
    country: 'CA',
    displayName: 'Canada',
    defaultCurrency: 'CAD',
    regulations: ['FINTRAC', 'PCMLTFA', 'PIPEDA', 'PCI_DSS'],
    screeningLists: ['CA_CONSOLIDATED', 'OFAC_SDN'],
    businessRegistries: ['CRA_BUSINESS_NUMBER', 'PROVINCIAL_REGISTRY'],
    bankAccountFormat: 'ca_transit',
    additionalSteps: ['fintrac_registration_check'],
    gdprApplies: false,
    taxIdLabel: 'Business Number',
  },
  AU: {
    country: 'AU',
    displayName: 'Australia',
    defaultCurrency: 'AUD',
    regulations: ['AML_CTF', 'AUSTRAC', 'PCI_DSS'],
    screeningLists: ['DFAT_CONSOLIDATED', 'OFAC_SDN'],
    businessRegistries: ['ASIC', 'ABN_LOOKUP'],
    bankAccountFormat: 'au_bsb',
    additionalSteps: ['austrac_reporting_enrolment'],
    gdprApplies: false,
    taxIdLabel: 'ABN',
  },
  IE: {
    country: 'IE',
    displayName: 'Ireland',
    defaultCurrency: 'EUR',
    regulations: ['GDPR', 'PSD2', 'AMLD5', 'PCI_DSS'],
    screeningLists: ['EU_CONSOLIDATED', 'OFAC_SDN'],
    businessRegistries: ['CRO', 'VIES_VAT'],
    bankAccountFormat: 'iban',
    additionalSteps: ['psd2_sca_attestation'],
    gdprApplies: true,
    taxIdLabel: 'VAT number',
  },
  DE: {
    country: 'DE',
    displayName: 'Germany',
    defaultCurrency: 'EUR',
    regulations: ['GDPR', 'PSD2', 'AMLD5', 'PCI_DSS'],
    screeningLists: ['EU_CONSOLIDATED', 'OFAC_SDN'],
    businessRegistries: ['HANDELSREGISTER', 'VIES_VAT'],
    bankAccountFormat: 'iban',
    additionalSteps: ['psd2_sca_attestation'],
    gdprApplies: true,
    taxIdLabel: 'VAT number',
  },
  FR: {
    country: 'FR',
    displayName: 'France',
    defaultCurrency: 'EUR',
    regulations: ['GDPR', 'PSD2', 'AMLD5', 'PCI_DSS'],
    screeningLists: ['EU_CONSOLIDATED', 'OFAC_SDN'],
    businessRegistries: ['INSEE_SIRENE', 'VIES_VAT'],
    bankAccountFormat: 'iban',
    additionalSteps: ['psd2_sca_attestation'],
    gdprApplies: true,
    taxIdLabel: 'SIREN',
  },
  SG: {
    country: 'SG',
    displayName: 'Singapore',
    defaultCurrency: 'SGD',
    regulations: ['MAS_PSA', 'PDPA', 'PCI_DSS'],
    screeningLists: ['MAS_TARGETED_FINANCIAL_SANCTIONS', 'OFAC_SDN'],
    businessRegistries: ['ACRA'],
    bankAccountFormat: 'iban',
    additionalSteps: [],
    gdprApplies: false,
    taxIdLabel: 'UEN',
  },
};

/** Countries without a dedicated profile board under this conservative baseline. */
const FALLBACK_REGION: Omit<RegionProfile, 'country'> = {
  displayName: 'Unmapped region',
  defaultCurrency: 'USD',
  regulations: ['PCI_DSS', 'FATF_RECOMMENDATIONS'],
  screeningLists: ['OFAC_SDN', 'UN_CONSOLIDATED'],
  businessRegistries: ['GLOBAL_BUSINESS_DATABASE'],
  bankAccountFormat: 'iban',
  additionalSteps: ['manual_compliance_review'],
  gdprApplies: false,
  taxIdLabel: 'Tax identification number',
};

/** Countries the platform will not board at all. */
export const PROHIBITED_COUNTRIES = ['IR', 'KP', 'SY', 'CU'];

export function isSupportedCountry(country: string): boolean {
  return !PROHIBITED_COUNTRIES.includes(country.toUpperCase());
}

export function getRegionProfile(country: string): RegionProfile {
  const code = country.toUpperCase();
  return REGIONS[code] ?? { ...FALLBACK_REGION, country: code };
}

export function listSupportedCountries(): string[] {
  return Object.keys(REGIONS);
}
