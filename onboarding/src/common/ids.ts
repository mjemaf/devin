import { randomBytes } from 'crypto';

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

export type IdPrefix =
  | 'mer'
  | 'owner'
  | 'ba'
  | 'doc'
  | 'ver'
  | 'risk'
  | 'uw'
  | 'wh'
  | 'whd'
  | 'evt'
  | 'par'
  | 'req';

/** Stripe-style opaque public identifier, e.g. `mer_8fq2l4x9c1`. */
export function newPublicId(prefix: IdPrefix, length = 16): string {
  const bytes = randomBytes(length);
  let out = '';
  for (const byte of bytes) {
    out += ALPHABET[byte % ALPHABET.length];
  }
  return `${prefix}_${out}`;
}
