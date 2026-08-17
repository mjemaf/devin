import { randomBytes, randomUUID } from 'crypto';

export const ID_PREFIXES = {
  partner: 'pt',
  apiKey: 'ak',
  merchant: 'mer',
  owner: 'owner',
  bankAccount: 'ba',
  document: 'doc',
  verification: 'ver',
  risk: 'risk',
  underwriting: 'uw',
  webhook: 'wh',
  delivery: 'whd',
  audit: 'log',
  event: 'evt',
  request: 'req',
} as const;

export type IdKind = keyof typeof ID_PREFIXES;

/** Generates an opaque, prefixed public identifier (e.g. `mer_9f2c...`). */
export function newId(kind: IdKind): string {
  return `${ID_PREFIXES[kind]}_${randomUUID().replace(/-/g, '').slice(0, 24)}`;
}

export function newSecret(prefix: string, bytes = 24): string {
  return `${prefix}_${randomBytes(bytes).toString('base64url')}`;
}

export function isId(kind: IdKind, value: string): boolean {
  return value.startsWith(`${ID_PREFIXES[kind]}_`);
}
