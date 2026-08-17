import { BusinessType } from '@prisma/client';
import { complianceProfileFor } from './compliance';
import { isGdprCountry, regionalProfile, requiredSteps } from './regional-requirements';

describe('regional requirements', () => {
  it.each([
    ['US', 'BSA_AML', 'secretary_of_state'],
    ['GB', 'FCA', 'companies_house'],
    ['CA', 'PCMLTFA', 'corporations_canada'],
    ['AU', 'AML_CTF', 'asic'],
    ['DE', 'GDPR', 'eu_business_register'],
  ])('maps %s to its regulator and registry', (country, regulation, registry) => {
    const profile = regionalProfile(country);
    expect(profile.regulations).toContain(regulation);
    expect(profile.businessRegistry).toBe(registry);
  });

  it('falls back to a sanctions-only profile for unmapped countries', () => {
    const profile = regionalProfile('JP');
    expect(profile.screenings).toEqual(['sanctions']);
    expect(profile.businessRegistry).toBeNull();
  });

  it('treats EEA countries as GDPR jurisdictions', () => {
    expect(isGdprCountry('FR')).toBe(true);
    expect(isGdprCountry('US')).toBe(false);
  });

  it('skips beneficial-owner collection for individuals', () => {
    expect(requiredSteps(BusinessType.individual)).not.toContain('owner_verification');
    expect(requiredSteps(BusinessType.company)).toContain('owner_verification');
  });

  it('only screens beneficial ownership for non-individuals', () => {
    expect(complianceProfileFor('US', BusinessType.company).required_screenings).toContain(
      'beneficial_ownership',
    );
    expect(complianceProfileFor('US', BusinessType.individual).required_screenings).not.toContain(
      'beneficial_ownership',
    );
  });
});
