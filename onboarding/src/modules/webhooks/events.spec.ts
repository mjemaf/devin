import { WEBHOOK_EVENTS, isWebhookEvent } from './events';

describe('webhook event catalogue', () => {
  it('covers every onboarding lifecycle stage', () => {
    expect(WEBHOOK_EVENTS).toEqual(
      expect.arrayContaining([
        'merchant.created',
        'merchant.verification_completed',
        'merchant.verification_failed',
        'merchant.risk_flagged',
        'merchant.underwriting_approved',
        'merchant.underwriting_declined',
        'merchant.underwriting_manual_review',
        'merchant.activated',
        'merchant.suspended',
        'bank_account.verified',
      ]),
    );
  });

  it('narrows unknown event names', () => {
    expect(isWebhookEvent('merchant.created')).toBe(true);
    expect(isWebhookEvent('merchant.exploded')).toBe(false);
  });
});
