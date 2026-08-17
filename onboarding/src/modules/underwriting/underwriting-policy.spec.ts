import { limitsFor, pricingTierFor } from './underwriting-policy';

describe('underwriting policy', () => {
  it('scales limits with risk level', () => {
    const low = limitsFor('low', 500_000);
    const high = limitsFor('high', 500_000);
    expect(low.monthly_volume_limit).toBeGreaterThan(high.monthly_volume_limit);
  });

  it('applies a floor so micro-merchants get a usable limit', () => {
    expect(limitsFor('low', 0).monthly_volume_limit).toBe(100_000);
  });

  it('holds a rolling reserve for anything above low risk', () => {
    expect(limitsFor('low', 100_000).rolling_reserve_bps).toBe(0);
    expect(limitsFor('low', 100_000).reserve_hold_days).toBe(0);
    expect(limitsFor('medium', 100_000).rolling_reserve_bps).toBeGreaterThan(0);
    expect(limitsFor('high', 100_000).rolling_reserve_bps).toBeGreaterThan(
      limitsFor('medium', 100_000).rolling_reserve_bps,
    );
    expect(limitsFor('high', 100_000).reserve_hold_days).toBe(90);
  });

  it('keeps daily limits below monthly limits', () => {
    const limits = limitsFor('medium', 250_000);
    expect(limits.daily_volume_limit).toBeLessThan(limits.monthly_volume_limit);
    expect(limits.max_transaction_amount).toBeLessThan(limits.monthly_volume_limit);
  });

  it('prices by risk level', () => {
    expect(pricingTierFor('low')).toBe('standard');
    expect(pricingTierFor('medium')).toBe('elevated');
    expect(pricingTierFor('high')).toBe('high_risk');
  });
});
