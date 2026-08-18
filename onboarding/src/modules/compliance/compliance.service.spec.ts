import { ComplianceService } from './compliance.service';

describe('ComplianceService', () => {
  const compliance = new ComplianceService();

  it('resolves region and localisation labels per country', () => {
    expect(compliance.rulesFor('US').region).toBe('US');
    expect(compliance.rulesFor('gb').registrationNumberLabel).toMatch(/Company/i);
    expect(compliance.rulesFor('DE').region).toBe('EU');
    expect(compliance.rulesFor('ZZ').region).toBe('OTHER');
  });

  it('asks companies for beneficial owners but not sole traders', () => {
    expect(compliance.requiredSteps('US', 'company')).toContain('owner_verification');
    expect(compliance.requiredSteps('US', 'individual')).not.toContain('owner_verification');
  });

  it('always requires business verification and a settlement account', () => {
    for (const country of ['US', 'GB', 'DE', 'AU', 'ZZ']) {
      expect(compliance.requiredSteps(country, 'company')).toEqual(
        expect.arrayContaining(['business_verification', 'bank_account_setup']),
      );
    }
  });

  it('derives GDPR applicability and screening lists from the region', () => {
    expect(compliance.profileFor('DE', 10_000).gdpr_compliant).toBe(true);
    expect(compliance.profileFor('US', 10_000).gdpr_compliant).toBe(false);
    expect(compliance.profileFor('US', 10_000).screening_lists).toContain('OFAC SDN');
  });

  it('maps annualised volume onto PCI DSS validation levels', () => {
    expect(compliance.profileFor('US', 600_000).pci_level).toBe('level_1');
    expect(compliance.profileFor('US', 100_000).pci_level).toBe('level_2');
    expect(compliance.profileFor('US', 5_000).pci_level).toBe('level_3');
    expect(compliance.profileFor('US', 1_000).pci_level).toBe('level_4');
  });
});
