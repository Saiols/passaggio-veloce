import { describe, it, expect } from 'vitest';
import { normalizePromoCode, evaluatePromoCode } from './evaluate';

const NOW = new Date('2026-06-04T12:00:00Z');
const base = { amountCent: 5000, expiresAt: null, active: true, maxRedemptions: null };

describe('normalizePromoCode', () => {
  it('trim + uppercase', () => {
    expect(normalizePromoCode('  benvenuto10 ')).toBe('BENVENUTO10');
  });
});

describe('evaluatePromoCode', () => {
  it('null → inesistente', () => {
    expect(evaluatePromoCode(null, 0, NOW)).toEqual({ stato: 'inesistente' });
  });
  it('non attivo → inesistente', () => {
    expect(evaluatePromoCode({ ...base, active: false }, 0, NOW)).toEqual({ stato: 'inesistente' });
  });
  it('scaduto', () => {
    expect(evaluatePromoCode({ ...base, expiresAt: new Date('2026-06-01') }, 0, NOW)).toEqual({ stato: 'scaduto' });
  });
  it('esaurito quando count >= maxRedemptions', () => {
    expect(evaluatePromoCode({ ...base, maxRedemptions: 2 }, 2, NOW)).toEqual({ stato: 'esaurito' });
  });
  it('valido con importo', () => {
    expect(evaluatePromoCode(base, 0, NOW)).toEqual({ stato: 'valido', amountCent: 5000 });
  });
  it('valido se scadenza futura e count < max', () => {
    expect(evaluatePromoCode({ ...base, expiresAt: new Date('2026-12-31'), maxRedemptions: 5 }, 4, NOW))
      .toEqual({ stato: 'valido', amountCent: 5000 });
  });
});
