import { assessRisk, RiskInput } from './risk-scoring';

const cleanMerchant: RiskInput = {
  mcc: '5734',
  country: 'US',
  estimatedMonthlyVolume: 50_000,
  incorporationDate: '2015-01-01',
  website: 'https://example.com',
  businessVerified: true,
  businessVerificationFailed: false,
  ownersVerified: 1,
  ownersTotal: 1,
  ownershipPercentageCovered: 100,
  bankAccountVerified: true,
  sanctionsHit: false,
  now: new Date('2026-01-01T00:00:00Z'),
};

describe('assessRisk', () => {
  it('scores a fully verified low-risk merchant as low', () => {
    const result = assessRisk(cleanMerchant);

    expect(result.riskLevel).toBe('low');
    expect(result.riskScore).toBeLessThan(35);
    expect(result.factors).toEqual({
      industry_risk: 'low',
      geographic_risk: 'low',
      volume_risk: 'low',
      identity_risk: 'low',
      business_profile_risk: 'low',
    });
    expect(result.recommendations).not.toContain('enhanced_monitoring');
  });

  it('treats a sanctions hit as prohibited and recommends declining', () => {
    const result = assessRisk({ ...cleanMerchant, sanctionsHit: true });

    expect(result.riskLevel).toBe('prohibited');
    expect(result.factors.identity_risk).toBe('prohibited');
    expect(result.recommendations).toEqual(['decline_application']);
  });

  it('marks an embargoed country as prohibited regardless of other factors', () => {
    expect(assessRisk({ ...cleanMerchant, country: 'IR' }).riskLevel).toBe('prohibited');
  });

  it('raises industry and volume risk for gambling at scale', () => {
    const result = assessRisk({
      ...cleanMerchant,
      mcc: '7995',
      estimatedMonthlyVolume: 2_000_000,
    });

    expect(result.factors.industry_risk).toBe('high');
    expect(result.factors.volume_risk).toBe('high');
    expect(result.riskScore).toBeGreaterThan(assessRisk(cleanMerchant).riskScore);
    expect(result.recommendations).toContain('require_industry_specific_underwriting');
  });

  it('flags unverified identity and an unverified settlement account', () => {
    const result = assessRisk({
      ...cleanMerchant,
      businessVerified: false,
      ownersVerified: 0,
      ownershipPercentageCovered: 0,
      bankAccountVerified: false,
    });

    expect(result.factors.identity_risk).toBe('high');
    expect(result.recommendations).toContain('request_additional_identity_documents');
    expect(result.recommendations).toContain('require_verified_settlement_account');
  });

  it('penalises a newly incorporated business without a website', () => {
    const young = assessRisk({
      ...cleanMerchant,
      incorporationDate: '2025-11-01',
      website: null,
    });

    expect(young.factors.business_profile_risk).toBe('high');
  });

  it('always emits a transaction limit recommendation for accepted merchants', () => {
    expect(assessRisk(cleanMerchant).recommendations.some((r) => r.startsWith('transaction_limits:'))).toBe(
      true,
    );
  });
});
