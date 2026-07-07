import { describe, it, expect } from 'vitest';
import { computeInvalid } from './field-errors';

describe('computeInvalid', () => {
  it('mai invalid se non toccato e non reveal (apertura pagina)', () => {
    expect(computeInvalid({ touched: false, reveal: false, valid: false })).toBe(false);
    expect(computeInvalid({ touched: false, reveal: false, valid: true })).toBe(false);
  });
  it('invalid se toccato e non valido', () => {
    expect(computeInvalid({ touched: true, reveal: false, valid: false })).toBe(true);
  });
  it('non invalid se toccato ma valido', () => {
    expect(computeInvalid({ touched: true, reveal: false, valid: true })).toBe(false);
  });
  it('invalid se reveal e non valido, anche non toccato', () => {
    expect(computeInvalid({ touched: false, reveal: true, valid: false })).toBe(true);
  });
  it('non invalid se reveal ma valido', () => {
    expect(computeInvalid({ touched: false, reveal: true, valid: true })).toBe(false);
  });
});
