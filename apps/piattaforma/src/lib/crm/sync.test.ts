import { describe, it, expect } from 'vitest';
import { isPreIscrizione } from './util';

describe('isPreIscrizione', () => {
  it('returns true for S0..S6', () => {
    for (const s of ['S0', 'S1', 'S2', 'S3', 'S4', 'S5', 'S6']) {
      expect(isPreIscrizione(s)).toBe(true);
    }
  });

  it('returns false for S7..S10', () => {
    for (const s of ['S7', 'S8', 'S9', 'S10']) {
      expect(isPreIscrizione(s)).toBe(false);
    }
  });

  it('returns false for unknown status', () => {
    expect(isPreIscrizione('SX')).toBe(false);
    expect(isPreIscrizione('')).toBe(false);
  });
});
