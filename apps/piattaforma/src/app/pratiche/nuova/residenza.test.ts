import { describe, expect, it } from 'vitest';
import { residenzaOk } from './residenza';

describe('residenzaOk', () => {
  it('ok quando la residenza è uguale al documento (nessun indirizzo richiesto)', () => {
    expect(residenzaOk(false, '')).toBe(true);
  });
  it('ok quando è diversa e l’indirizzo è compilato', () => {
    expect(residenzaOk(true, 'Via Roma 1, Milano')).toBe(true);
  });
  it('ko quando è diversa ma l’indirizzo è vuoto o solo spazi', () => {
    expect(residenzaOk(true, '')).toBe(false);
    expect(residenzaOk(true, '   ')).toBe(false);
  });
});
