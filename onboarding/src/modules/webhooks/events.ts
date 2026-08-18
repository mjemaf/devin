export const WEBHOOK_EVENTS = [
  'merchant.created',
  'merchant.updated',
  'merchant.verification_completed',
  'merchant.verification_failed',
  'merchant.risk_flagged',
  'merchant.underwriting_approved',
  'merchant.underwriting_declined',
  'merchant.underwriting_manual_review',
  'merchant.activated',
  'merchant.suspended',
  'bank_account.verified',
  'bank_account.verification_failed',
  'document.expiring',
] as const;

export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

export function isWebhookEvent(value: string): value is WebhookEvent {
  return (WEBHOOK_EVENTS as readonly string[]).includes(value);
}
