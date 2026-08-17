import { createHash, createHmac, timingSafeEqual } from 'crypto';

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/**
 * Deterministic surrogate for a sensitive value. A production deployment would
 * call a PCI-scoped vault here; the token shape (`tok_<hash>`) is what callers see.
 */
export function tokenize(value: string, namespace: string): string {
  return `tok_${createHmac('sha256', namespace).update(value).digest('hex').slice(0, 32)}`;
}

export function last4(value: string): string {
  return value.slice(-4).padStart(4, '0');
}

export function maskAllButLast4(value: string): string {
  if (value.length <= 4) return '*'.repeat(value.length);
  return `${'*'.repeat(value.length - 4)}${value.slice(-4)}`;
}

export function signPayload(secret: string, timestamp: number, body: string): string {
  return createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
}

export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
