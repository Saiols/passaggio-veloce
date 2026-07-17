import { describe, it, expect } from 'vitest';
import { giorniCalendarioTrascorsi, fermaLevel } from './giorni-fermi';

describe('giorniCalendarioTrascorsi', () => {
  it('null se from è null', () => {
    expect(giorniCalendarioTrascorsi(null, new Date('2026-07-17T12:00:00Z'))).toBeNull();
  });
  it('stesso giorno di calendario Roma → 0', () => {
    expect(
      giorniCalendarioTrascorsi(new Date('2026-07-17T06:00:00Z'), new Date('2026-07-17T20:00:00Z')),
    ).toBe(0);
  });
  it('conta i confini di mezzanotte, non i periodi di 24h', () => {
    // from = 2026-07-14 (Roma), now = 2026-07-17 (Roma) → 3 giorni di calendario
    expect(
      giorniCalendarioTrascorsi(new Date('2026-07-14T12:00:00Z'), new Date('2026-07-17T09:00:00Z')),
    ).toBe(3);
  });
  it('mezzanotte Roma: 23:30Z del 16 è già il 17 a Roma (estate +2)', () => {
    // from Roma 2026-07-17 01:30, now Roma 2026-07-19 10:00 → 2 giorni
    expect(
      giorniCalendarioTrascorsi(new Date('2026-07-16T23:30:00Z'), new Date('2026-07-19T08:00:00Z')),
    ).toBe(2);
  });
});

describe('fermaLevel', () => {
  it('rosso a ≥3, ambra a 2, neutro sotto, ok se null', () => {
    expect(fermaLevel(null)).toBe('ok');
    expect(fermaLevel(0)).toBe('ok');
    expect(fermaLevel(1)).toBe('ok');
    expect(fermaLevel(2)).toBe('warn');
    expect(fermaLevel(3)).toBe('urgent');
    expect(fermaLevel(9)).toBe('urgent');
  });
});
