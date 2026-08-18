import { COUNTRY_RISK, DEFAULT_COUNTRY_RISK, PROHIBITED_MCCS, riskLevelFor } from './risk-data';

describe('risk banding', () => {
  it('bands scores into low, medium and high', () => {
    expect(riskLevelFor(10, false)).toBe('low');
    expect(riskLevelFor(39, false)).toBe('low');
    expect(riskLevelFor(40, false)).toBe('medium');
    expect(riskLevelFor(74, false)).toBe('medium');
    expect(riskLevelFor(75, false)).toBe('high');
  });

  it('short-circuits to prohibited regardless of score', () => {
    expect(riskLevelFor(0, true)).toBe('prohibited');
  });

  it('keeps prohibited categories out of the risk-weighted set', () => {
    expect(Object.keys(PROHIBITED_MCCS)).toContain('7995');
  });

  it('falls back to the default weighting for unlisted jurisdictions', () => {
    expect(COUNTRY_RISK.US).toBeLessThan(DEFAULT_COUNTRY_RISK);
    expect(COUNTRY_RISK.ZZ).toBeUndefined();
  });
});
