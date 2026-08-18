import { REFERENCE_PREFIXES, newReference, newRequestId } from './references';

describe('public references', () => {
  it('prefixes by resource kind and stays opaque', () => {
    for (const [kind, prefix] of Object.entries(REFERENCE_PREFIXES)) {
      const reference = newReference(kind as keyof typeof REFERENCE_PREFIXES);
      expect(reference.startsWith(`${prefix}_`)).toBe(true);
      expect(reference.length).toBeLessThanOrEqual(40);
    }
  });

  it('never repeats', () => {
    const references = new Set(Array.from({ length: 500 }, () => newReference('merchant')));
    expect(references.size).toBe(500);
    expect(newRequestId()).toMatch(/^req_[0-9a-f]+$/);
  });
});
