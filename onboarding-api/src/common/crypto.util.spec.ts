import { createHmac } from 'crypto';
import { last4, maskAllButLast4, safeEqual, sha256, signPayload, tokenize } from './crypto.util';

describe('tokenize', () => {
  it('is deterministic within a namespace and different across namespaces', () => {
    expect(tokenize('123456789', 'bank')).toBe(tokenize('123456789', 'bank'));
    expect(tokenize('123456789', 'bank')).not.toBe(tokenize('123456789', 'tax'));
  });

  it('never leaks the source value', () => {
    const token = tokenize('123456789', 'bank');
    expect(token).toMatch(/^tok_[0-9a-f]{32}$/);
    expect(token).not.toContain('123456789');
  });
});

describe('masking helpers', () => {
  it('keeps only the last four digits', () => {
    expect(last4('000123456789')).toBe('6789');
    expect(last4('12')).toBe('0012');
    expect(maskAllButLast4('123456789')).toBe('*****6789');
    expect(maskAllButLast4('123')).toBe('***');
  });
});

describe('signPayload', () => {
  it('signs the timestamped body so receivers can replay-protect', () => {
    const body = JSON.stringify({ id: 'evt_1' });
    const expected = createHmac('sha256', 'whsec_test').update(`1700000000.${body}`).digest('hex');

    expect(signPayload('whsec_test', 1_700_000_000, body)).toBe(expected);
    expect(signPayload('whsec_test', 1_700_000_001, body)).not.toBe(expected);
    expect(signPayload('whsec_other', 1_700_000_000, body)).not.toBe(expected);
  });
});

describe('safeEqual', () => {
  it('compares equal-length strings and rejects mismatched lengths', () => {
    expect(safeEqual(sha256('a'), sha256('a'))).toBe(true);
    expect(safeEqual(sha256('a'), sha256('b'))).toBe(false);
    expect(safeEqual('short', 'longer-value')).toBe(false);
  });
});
