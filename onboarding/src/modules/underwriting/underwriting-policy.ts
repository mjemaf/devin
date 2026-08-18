type Tiered = 'low' | 'medium' | 'high';

/**
 * Approved merchants start with staged limits derived from their own projection, so a
 * new account cannot immediately process far beyond what was underwritten.
 */
export function limitsFor(riskLevel: string, estimatedMonthlyVolume: number): Record<string, number> {
  const multiplier = riskLevel === 'low' ? 2 : riskLevel === 'medium' ? 1.5 : 1;
  const monthly = Math.max(100_000, Math.round(estimatedMonthlyVolume * multiplier));
  const reserveBps = riskLevel === 'low' ? 0 : riskLevel === 'medium' ? 500 : 1000;

  return {
    max_transaction_amount: Math.round(monthly / 10),
    daily_volume_limit: Math.round(monthly / 20),
    monthly_volume_limit: monthly,
    /** Rolling reserve held against chargebacks, in basis points of volume. */
    rolling_reserve_bps: reserveBps,
    reserve_hold_days: reserveBps === 0 ? 0 : 90,
  };
}

export function pricingTierFor(riskLevel: string): string {
  const tiers: Record<Tiered, string> = {
    low: 'standard',
    medium: 'elevated',
    high: 'high_risk',
  };
  return tiers[(riskLevel as Tiered) in tiers ? (riskLevel as Tiered) : 'medium'];
}
