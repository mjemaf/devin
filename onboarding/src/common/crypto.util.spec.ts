import {
  apiKeyPrefix,
  detokenize,
  generateApiKey,
  hashApiKey,
  last4,
  safeEqual,
  tokenize,
  webhookSignature,
} from './crypto.util';

describe('crypto util', () => {
  it('generates environment-scoped api keys and stable hashes', () => {
    const key = generateApiKey('sandbox');
    expect(key).toMatch(/^sk_sandbox_[0-9a-f]{48}$/);
    expect(hashApiKey(key)).toEqual(hashApiKey(key));
    expect(hashApiKey(key)).not.toContain(key);
    expect(apiKeyPrefix(key)).toHaveLength(12);
  });

  it('compares strings without leaking length mismatches', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
  });

  it('round-trips tokenized values and never stores plaintext', () => {
    const token = tokenize('000123456789', 'secret');
    expect(token.startsWith('v1:')).toBe(true);
    expect(token).not.toContain('000123456789');
    expect(detokenize(token, 'secret')).toBe('000123456789');
  });

  it('rejects tampered or foreign-key tokens', () => {
    const token = tokenize('12-3456789', 'secret');
    expect(() => detokenize(token, 'other-secret')).toThrow();
    expect(() => detokenize('garbage', 'secret')).toThrow('Malformed token');
  });

  it('signs webhook payloads over timestamp and body', () => {
    const signature = webhookSignature('whsec', 1_700_000_000, '{"a":1}');
    expect(signature).toHaveLength(64);
    expect(webhookSignature('whsec', 1_700_000_001, '{"a":1}')).not.toEqual(signature);
  });

  it('extracts the last four digits of formatted values', () => {
    expect(last4('12-3456789')).toBe('6789');
    expect(last4('4242 4242 4242 1234')).toBe('1234');
  });
});
