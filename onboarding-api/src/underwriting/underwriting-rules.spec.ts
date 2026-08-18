import { decideUnderwriting, UnderwritingInput } from './underwriting-rules';

const readyForApproval: UnderwritingInput = {
  riskScore: 22,
  riskLevel: 'low',
  estimatedMonthlyVolume: 50_000,
  currency: 'USD',
  businessVerified: true,
  bankAccountVerified: true,
  ownersVerified: true,
  sanctionsHit: false,
  expedited: false,
};

describe('decideUnderwriting', () => {
  it('approves a fully verified low-risk merchant with risk-based limits', () => {
    const result = decideUnderwriting(readyForApproval);

    expect(result.decision).toBe('approved');
    expect(result.reasonCodes).toEqual(['automated_approval']);
    expect(result.pricingTier).toBe('preferred');
    expect(result.expiresInDays).toBe(7);
    expect(result.processingLimits).toMatchObject({ currency: 'USD', monthly_limit: 100_000 });
    expect(result.processingLimits!.daily_limit).toBeLessThan(result.processingLimits!.monthly_limit);
  });

  it('shortens the validity window for expedited approvals', () => {
    expect(decideUnderwriting({ ...readyForApproval, expedited: true }).expiresInDays).toBe(3);
  });

  it('declines on a sanctions hit before evaluating anything else', () => {
    const result = decideUnderwriting({
      ...readyForApproval,
      sanctionsHit: true,
      businessVerified: false,
    });

    expect(result.decision).toBe('declined');
    expect(result.reasonCodes).toEqual(['sanctions_screening_hit']);
    expect(result.processingLimits).toBeNull();
  });

  it('declines a prohibited risk level', () => {
    const result = decideUnderwriting({ ...readyForApproval, riskLevel: 'prohibited' });

    expect(result.decision).toBe('declined');
    expect(result.reasonCodes).toEqual(['prohibited_jurisdiction']);
  });

  it('routes incomplete verification to manual review and reports every blocker', () => {
    const result = decideUnderwriting({
      ...readyForApproval,
      businessVerified: false,
      bankAccountVerified: false,
      ownersVerified: false,
    });

    expect(result.decision).toBe('manual_review');
    expect(result.reasonCodes).toEqual([
      'business_verification_incomplete',
      'bank_account_unverified',
      'owner_verification_incomplete',
    ]);
  });

  it('routes high risk and very high volume to manual review', () => {
    expect(decideUnderwriting({ ...readyForApproval, riskLevel: 'high', riskScore: 88 })).toMatchObject({
      decision: 'manual_review',
      reasonCodes: ['risk_score_above_threshold'],
      pricingTier: 'elevated_risk',
    });
    expect(
      decideUnderwriting({ ...readyForApproval, estimatedMonthlyVolume: 750_000 }),
    ).toMatchObject({ decision: 'manual_review', reasonCodes: ['volume_above_threshold'] });
  });

  it('scales limits down as risk increases', () => {
    const low = decideUnderwriting(readyForApproval).processingLimits!;
    const medium = decideUnderwriting({
      ...readyForApproval,
      riskLevel: 'medium',
      riskScore: 55,
    }).processingLimits!;

    expect(medium.monthly_limit).toBeLessThan(low.monthly_limit);
  });
});
