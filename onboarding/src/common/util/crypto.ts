import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from 'node:crypto';

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function hmacSha256(secret: string, payload: string): string {
  return createHmac('sha256', secret).update(payload).digest('hex');
}

export function randomToken(bytes = 24): string {
  return randomBytes(bytes).toString('hex');
}

/**
 * AES-256-GCM tokenisation for values that must be recoverable for settlement but
 * never returned over the API (full bank account numbers).
 */
export function encryptValue(hexKey: string, plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(hexKey, 'hex'), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return [iv.toString('hex'), cipher.getAuthTag().toString('hex'), ciphertext.toString('hex')].join(
    ':',
  );
}

export function decryptValue(hexKey: string, token: string): string {
  const [iv, tag, ciphertext] = token.split(':');
  const decipher = createDecipheriv('aes-256-gcm', Buffer.from(hexKey, 'hex'), Buffer.from(iv, 'hex'));
  decipher.setAuthTag(Buffer.from(tag, 'hex'));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, 'hex')), decipher.final()]).toString(
    'utf8',
  );
}

export function maskTail(value: string, keep = 4): string {
  const tail = value.slice(-keep);
  return `${'*'.repeat(Math.max(value.length - keep, 0))}${tail}`;
}
