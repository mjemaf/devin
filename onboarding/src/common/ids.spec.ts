import { newPublicId } from './ids';

describe('newPublicId', () => {
  it('produces prefixed lowercase identifiers', () => {
    expect(newPublicId('mer')).toMatch(/^mer_[a-z0-9]{16}$/);
    expect(newPublicId('ba', 8)).toMatch(/^ba_[a-z0-9]{8}$/);
  });

  it('produces unique values', () => {
    const ids = new Set(Array.from({ length: 500 }, () => newPublicId('owner')));
    expect(ids.size).toBe(500);
  });
});
