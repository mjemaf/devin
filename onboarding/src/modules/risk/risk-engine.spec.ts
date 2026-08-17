import { RiskLevel } from '@prisma/client';
import { RiskInput, assessRisk } from './risk-engine';

const baseline: RiskInput = {
  mcc: '5812',
  country: 'US',
  estimatedMonthlyVolume: 50_000,
  businessVerified: true,
  ownersVerified: true,
  bankAccountVerified: true,
  ownerCount: 1,
  disclosedOwnershipPercentage: 100,
  documentCount: 2,
  websitePresent: true,
};

describe('assessRisk', () => {
  it('scores a fully verified SMB merchant as low risk', () => {
    const result = assessRisk(baseline);
    expect(result.riskLevel).toBe(RiskLevel.low);
    expect(result.riskScore).toBeLessThan(30);
    expect(result.recommendations).toContain('standard_monitoring');
  });

  it('never averages away a prohibited MCC', () => {
    const result = assessRisk({ ...baseline, mcc: '7995' });
    expect(result.riskScore).toBeGreaterThanOrEqual(90);
    expect(result.riskLevel).toBe(RiskLevel.prohibited);
    expect(result.recommendations).toEqual(['decline_application']);
  });

  it('never averages away a sanctioned jurisdiction', () => {
    const result = assessRisk({ ...baseline, country: 'IR' });
    expect(result.riskLevel).toBe(RiskLevel.prohibited);
  });

  it('escalates high-risk industries', () => {
    const result = assessRisk({ ...baseline, mcc: '5962' });
    expect(result.factors.industry_risk.level).toBe(RiskLevel.high);
    expect(result.riskLevel).not.toBe(RiskLevel.low);
  });

  it('flags missing verification in the identity factor', () => {
    const result = assessRisk({ ...baseline, businessVerified: false, bankAccountVerified: false });
    expect(result.factors.identity_risk.reason).toContain('business');
    expect(result.factors.identity_risk.reason).toContain('bank_account');
    expect(result.factors.identity_risk.score).toBeGreaterThan(
      assessRisk(baseline).factors.identity_risk.score,
    );
  });

  it('flags undisclosed beneficial ownership', () => {
    const result = assessRisk({ ...baseline, disclosedOwnershipPercentage: 40 });
    expect(result.factors.identity_risk.reason).toContain('beneficial ownership');
  });

  it('treats implausible volumes as risk in both directions', () => {
    expect(assessRisk({ ...baseline, estimatedMonthlyVolume: 5_000_000 }).riskScore).toBeGreaterThan(
      assessRisk(baseline).riskScore,
    );
    expect(assessRisk({ ...baseline, estimatedMonthlyVolume: 100 }).riskScore).toBeGreaterThan(
      assessRisk(baseline).riskScore,
    );
  });

  it('asks for documents when none are on file', () => {
    const result = assessRisk({ ...baseline, documentCount: 0 });
    expect(result.recommendations).toContain('request_supporting_documents');
  });

  it('scales transaction limits down as risk rises', () => {
    const low = assessRisk(baseline).recommendations.find((r) => r.startsWith('transaction_limits'));
    const high = assessRisk({ ...baseline, mcc: '5962' }).recommendations.find((r) =>
      r.startsWith('transaction_limits'),
    );
    expect(Number(low?.split(':')[1])).toBeGreaterThan(Number(high?.split(':')[1]));
  });
});
