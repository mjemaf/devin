import { BusinessType } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { isGdprCountry, regionalProfile } from './regional-requirements';

export interface ComplianceProfile {
  pci_level: string;
  gdpr_compliant: boolean;
  regional_compliance: string[];
  required_screenings: string[];
  data_residency: string;
}

/**
 * SMB merchants boarded through the platform inherit the platform's PCI Level 1
 * service-provider scope and are self-assessed at SAQ-A.
 */
export function complianceProfileFor(
  country: string,
  businessType: BusinessType,
): ComplianceProfile {
  const profile = regionalProfile(country);
  const screenings =
    businessType === BusinessType.individual
      ? profile.screenings
      : [...profile.screenings, 'beneficial_ownership'];
  return {
    pci_level: 'saq_a',
    gdpr_compliant: isGdprCountry(country),
    regional_compliance: profile.regulations,
    required_screenings: screenings,
    data_residency: profile.dataResidency,
  };
}

export function toJson(profile: ComplianceProfile): Prisma.InputJsonValue {
  return profile as unknown as Prisma.InputJsonValue;
}
