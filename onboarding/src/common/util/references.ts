import { randomBytes, randomUUID } from 'node:crypto';

export const REFERENCE_PREFIXES = {
  merchant: 'mer',
  owner: 'owner',
  bankAccount: 'ba',
  document: 'doc',
  verification: 'ver',
  risk: 'risk',
  underwriting: 'uw',
  webhook: 'wh',
  event: 'evt',
  request: 'req',
} as const;

export type ReferenceKind = keyof typeof REFERENCE_PREFIXES;

/** Stripe-style prefixed public identifier; the UUID primary key stays internal. */
export function newReference(kind: ReferenceKind): string {
  return `${REFERENCE_PREFIXES[kind]}_${randomBytes(12).toString('hex')}`;
}

export function newRequestId(): string {
  return `${REFERENCE_PREFIXES.request}_${randomUUID().replace(/-/g, '')}`;
}
