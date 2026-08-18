import { decryptValue, encryptValue, hmacSha256, maskTail, randomToken, sha256 } from './crypto';

const KEY = '0'.repeat(64);

describe('crypto helpers', () => {
  it('hashes deterministically', () => {
    expect(sha256('sk_test_abc')).toBe(sha256('sk_test_abc'));
    expect(sha256('sk_test_abc')).not.toBe(sha256('sk_test_abd'));
    expect(sha256('sk_test_abc')).toHaveLength(64);
  });

  it('round-trips tokenised values without leaking plaintext', () => {
    const token = encryptValue(KEY, '000123456789');
    expect(token).not.toContain('000123456789');
    expect(decryptValue(KEY, token)).toBe('000123456789');
  });

  it('produces a distinct token per call for the same input', () => {
    expect(encryptValue(KEY, '000123456789')).not.toBe(encryptValue(KEY, '000123456789'));
  });

  it('rejects tampered tokens', () => {
    const token = encryptValue(KEY, '000123456789');
    const tampered = `${token.slice(0, -2)}${token.endsWith('ab') ? 'cd' : 'ab'}`;
    expect(() => decryptValue(KEY, tampered)).toThrow();
  });

  it('signs payloads with HMAC-SHA256', () => {
    expect(hmacSha256('whsec_1', '1700000000.{}')).toBe(hmacSha256('whsec_1', '1700000000.{}'));
    expect(hmacSha256('whsec_1', '1700000000.{}')).not.toBe(hmacSha256('whsec_2', '1700000000.{}'));
  });

  it('masks all but the trailing digits', () => {
    expect(maskTail('123456789')).toBe('*****6789');
    expect(maskTail('12', 4)).toBe('12');
  });

  it('generates unique tokens', () => {
    expect(randomToken()).not.toBe(randomToken());
  });
});
