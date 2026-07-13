import { describe, it, expect } from 'vitest';
import { computeGiorniResidui, countdownLevel, giorniTrascorsi, attesaLevel } from './countdown';

describe('computeGiorniResidui', () => {
  const now = new Date('2026-06-01T10:00:00.000Z');
  it('returns null when no date', () => {
    expect(computeGiorniResidui(null, now)).toBeNull();
  });
  it('counts whole days remaining (ceil)', () => {
    expect(computeGiorniResidui(new Date('2026-06-06T09:00:00.000Z'), now)).toBe(5);
  });
  it('returns 1 within the final day', () => {
    expect(computeGiorniResidui(new Date('2026-06-01T18:00:00.000Z'), now)).toBe(1);
  });
  it('returns negative when overdue', () => {
    expect(computeGiorniResidui(new Date('2026-05-30T10:00:00.000Z'), now)).toBe(-2);
  });
});

describe('countdownLevel', () => {
  it('classifies by days remaining', () => {
    expect(countdownLevel(10)).toBe('ok');
    expect(countdownLevel(5)).toBe('warn');
    expect(countdownLevel(2)).toBe('urgent');
    expect(countdownLevel(0)).toBe('urgent');
    expect(countdownLevel(-1)).toBe('overdue');
    expect(countdownLevel(null)).toBe('none');
  });
});

const NOW = new Date('2026-07-13T12:00:00Z');
const giorniFa = (n: number): Date => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000);

describe('giorniTrascorsi', () => {
  it('conta i giorni interi passati da una data', () => {
    expect(giorniTrascorsi(giorniFa(5), NOW)).toBe(5);
  });

  it('oggi stesso è 0 giorni', () => {
    expect(giorniTrascorsi(NOW, NOW)).toBe(0);
  });

  it('tronca le frazioni di giorno (18 ore = 0 giorni pieni)', () => {
    const diciottoOreFa = new Date(NOW.getTime() - 18 * 60 * 60 * 1000);
    expect(giorniTrascorsi(diciottoOreFa, NOW)).toBe(0);
  });

  it('null se la data non c\'è', () => {
    expect(giorniTrascorsi(null, NOW)).toBeNull();
  });
});

describe('attesaLevel', () => {
  it.each([
    [0, 'ok'],
    [3, 'ok'],
    [4, 'warn'],
    [7, 'warn'],
    [8, 'urgent'],
    [40, 'urgent'],
  ])('%i giorni di attesa → %s', (giorni, atteso) => {
    expect(attesaLevel(giorni as number)).toBe(atteso);
  });

  it('null → none', () => {
    expect(attesaLevel(null)).toBe('none');
  });

  it('è l\'INVERSO di countdownLevel: più giorni = più grave', () => {
    // countdownLevel conta i giorni RESIDUI (meno = peggio). Se qualcuno
    // riusasse quella per l'attesa, i colori sarebbero invertiti.
    expect(attesaLevel(1)).toBe('ok');
    expect(attesaLevel(30)).toBe('urgent');
  });
});
