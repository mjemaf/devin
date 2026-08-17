import { Decision, RiskLevel } from '@prisma/client';
import { UnderwritingInput, underwrite } from './underwriting-engine';

const baseline: UnderwritingInput = {
  riskScore: 20,
  riskLevel: RiskLevel.low,
  estimatedMonthlyVolume: 50_000,
  currency: 'USD',
  businessVerified: true,
  ownersVerified: true,
  bankAccountVerified: true,
  outstandingSteps: [],
  expedited: false,
};

describe('underwrite', () => {
  it('auto-approves a verified low-risk merchant with derived limits', () => {
    const result = underwrite(baseline);
    expect(result.decision).toBe(Decision.approved);
    expect(result.pricingTier).toBe('standard');
    expect(result.processingLimits).toEqual({
      daily_limit: 10_000,
      monthly_limit: 100_000,
      ticket_size_limit: 5_000,
      currency: 'USD',
    });
    expect(result.validForHours).toBe(168);
  });

  it('declines prohibited risk without limits', () => {
    const result = underwrite({ ...baseline, riskLevel: RiskLevel.prohibited, riskScore: 95 });
    expect(result.decision).toBe(Decision.declined);
    expect(result.processingLimits).toBeNull();
    expect(result.validForHours).toBeNull();
    expect(result.reasonCodes).toContain('prohibited_risk_profile');
  });

  it('routes unmet verification to manual review with itemized blockers', () => {
    const result = underwrite({
      ...baseline,
      bankAccountVerified: false,
      outstandingSteps: ['bank_account_setup'],
    });
    expect(result.decision).toBe(Decision.manual_review);
    expect(result.reasonCodes).toEqual([
      'bank_account_not_verified',
      'step_incomplete:bank_account_setup',
    ]);
  });

  it('routes high risk to an underwriter even when fully verified', () => {
    const result = underwrite({ ...baseline, riskLevel: RiskLevel.high, riskScore: 70 });
    expect(result.decision).toBe(Decision.manual_review);
    expect(result.pricingTier).toBe('high_risk');
  });

  it('shortens the review SLA for expedited submissions', () => {
    const result = underwrite({ ...baseline, riskLevel: RiskLevel.high, expedited: true });
    expect(result.validForHours).toBe(4);
  });

  it('tightens limits for medium risk merchants', () => {
    const medium = underwrite({ ...baseline, riskLevel: RiskLevel.medium, riskScore: 45 });
    expect(medium.decision).toBe(Decision.approved);
    expect(medium.pricingTier).toBe('standard_plus');
    expect(medium.processingLimits?.monthly_limit).toBeLessThan(100_000);
  });

  it('floors limits for very small merchants', () => {
    const result = underwrite({ ...baseline, estimatedMonthlyVolume: 10 });
    expect(result.processingLimits?.monthly_limit).toBe(1_000);
  });
});
