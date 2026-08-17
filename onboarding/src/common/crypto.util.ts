import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'crypto';

const API_KEY_PREFIX_LENGTH = 12;

export function generateApiKey(environment: 'sandbox' | 'live' = 'sandbox'): string {
  return `sk_${environment}_${randomBytes(24).toString('hex')}`;
}

export function hashApiKey(apiKey: string): string {
  return createHash('sha256').update(apiKey).digest('hex');
}

export function apiKeyPrefix(apiKey: string): string {
  return apiKey.slice(0, API_KEY_PREFIX_LENGTH);
}

export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) {
    return false;
  }
  return timingSafeEqual(left, right);
}

export function webhookSignature(secret: string, timestamp: number, body: string): string {
  return createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
}

function encryptionKey(secret: string): Buffer {
  return createHash('sha256').update(secret).digest();
}

/**
 * Envelope-encrypts a sensitive value (bank account numbers, tax ids) so only a
 * token is ever persisted. Format: `v1:<iv>:<authTag>:<ciphertext>`, all base64url.
 */
export function tokenize(plaintext: string, secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(secret), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const parts = [iv, cipher.getAuthTag(), ciphertext].map((part) => part.toString('base64url'));
  return ['v1', ...parts].join(':');
}

export function detokenize(token: string, secret: string): string {
  const [version, iv, authTag, ciphertext] = token.split(':');
  if (version !== 'v1' || !iv || !authTag || !ciphertext) {
    throw new Error('Malformed token');
  }
  const decipher = createDecipheriv(
    'aes-256-gcm',
    encryptionKey(secret),
    Buffer.from(iv, 'base64url'),
  );
  decipher.setAuthTag(Buffer.from(authTag, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}

export function last4(value: string): string {
  return value.replace(/\D/g, '').slice(-4);
}
