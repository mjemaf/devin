import { Injectable } from '@nestjs/common';
import { getRegionProfile, RegionProfile } from './regions';

export interface ComplianceProfile {
  pci_level: string;
  gdpr_compliant: boolean;
  regional_compliance: string[];
  screening_lists: string[];
  data_residency: string;
}

@Injectable()
export class ComplianceService {
  profileFor(country: string, estimatedMonthlyVolume: number): ComplianceProfile {
    const region = getRegionProfile(country);
    return {
      pci_level: this.pciLevel(estimatedMonthlyVolume),
      gdpr_compliant: region.gdprApplies,
      regional_compliance: region.regulations,
      screening_lists: region.screeningLists,
      data_residency: this.dataResidency(region),
    };
  }

  region(country: string): RegionProfile {
    return getRegionProfile(country);
  }

  /**
   * PCI merchant levels are defined on annual card transaction counts; volume is used
   * here as a proxy assuming an average ticket of $50.
   */
  private pciLevel(estimatedMonthlyVolume: number): string {
    const annualTransactions = (estimatedMonthlyVolume * 12) / 50;
    if (annualTransactions > 6_000_000) return 'level_1';
    if (annualTransactions > 1_000_000) return 'level_2';
    if (annualTransactions > 20_000) return 'level_3';
    return 'level_4';
  }

  private dataResidency(region: RegionProfile): string {
    if (region.gdprApplies) return 'eu';
    if (region.country === 'AU' || region.country === 'SG') return 'apac';
    if (region.country === 'CA') return 'ca';
    return 'us';
  }
}
