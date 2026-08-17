import { Injectable } from '@nestjs/common';
import { BusinessType } from '@prisma/client';
import { RegionalRules, rulesForCountry } from './regional-rules';

export interface ComplianceProfile {
  pci_level: string;
  gdpr_compliant: boolean;
  regional_compliance: string[];
  screening_lists: string[];
  data_residency: string;
  beneficial_owner_threshold: number;
}

export type OnboardingStepName =
  | 'business_verification'
  | 'bank_account_setup'
  | 'owner_verification'
  | 'document_upload';

@Injectable()
export class ComplianceService {
  rulesFor(country: string): RegionalRules {
    return rulesForCountry(country);
  }

  profileFor(country: string, estimatedMonthlyVolume: number): ComplianceProfile {
    const rules = this.rulesFor(country);
    return {
      pci_level: this.pciLevelFor(estimatedMonthlyVolume),
      gdpr_compliant: rules.region === 'EU' || rules.region === 'UK',
      regional_compliance: rules.regulations,
      screening_lists: rules.screeningLists,
      data_residency: rules.dataResidency,
      beneficial_owner_threshold: rules.beneficialOwnerThreshold,
    };
  }

  /**
   * Steps are country- and entity-aware: sole traders skip beneficial ownership,
   * and regions with stricter KYB add an explicit document collection step.
   */
  requiredSteps(country: string, businessType: BusinessType): OnboardingStepName[] {
    const rules = this.rulesFor(country);
    const steps: OnboardingStepName[] = ['business_verification', 'bank_account_setup'];

    if (businessType === 'company') {
      steps.push('owner_verification');
    }
    if (rules.requiredDocuments.length > (businessType === 'company' ? 1 : 0)) {
      steps.push('document_upload');
    }
    return steps;
  }

  requiredDocuments(country: string): string[] {
    return this.rulesFor(country).requiredDocuments;
  }

  /**
   * PCI DSS validation level derived from annualised card volume, using the
   * standard Level 1 (>6M), 2 (>1M), 3 (>20k e-commerce) thresholds.
   */
  private pciLevelFor(estimatedMonthlyVolume: number): string {
    const annual = estimatedMonthlyVolume * 12;
    if (annual > 6_000_000) {
      return 'level_1';
    }
    if (annual > 1_000_000) {
      return 'level_2';
    }
    if (annual > 20_000) {
      return 'level_3';
    }
    return 'level_4';
  }
}
