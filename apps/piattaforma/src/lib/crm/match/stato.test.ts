import { describe, it, expect } from 'vitest';
import { statoAllineato, datiFunnel } from './stato';

describe('statoAllineato', () => {
  it('mappa il numero di firmate sul funnel', () => {
    expect(statoAllineato('S0', 0)).toBe('S7');
    expect(statoAllineato('S0', 1)).toBe('S8');
    expect(statoAllineato('S0', 5)).toBe('S9');
  });

  it('non retrocede mai', () => {
    expect(statoAllineato('S9', 0)).toBe('S9');
    expect(statoAllineato('S8', 1)).toBe('S8');
  });

  it('non tocca il churn', () => {
    expect(statoAllineato('S10', 3)).toBe('S10');
  });

  it('uno stato fuori scala cade sul target', () => {
    expect(statoAllineato('SX', 2)).toBe('S9');
  });
});

describe('datiFunnel', () => {
  const storico = {
    firmate: 0,
    primaPraticaAt: null,
    sospesa: false,
    referral: false,
  };

  it('azienda registrata senza firme: S7, INATTIVO, primaPratica false', () => {
    expect(datiFunnel('S0', storico)).toEqual({
      status: 'S7',
      platStatus: 'INATTIVO',
      primaPratica: false,
      primaPraticaAt: null,
    });
  });

  it('azienda che ha firmato: ATTIVO e prima pratica valorizzata', () => {
    const prima = new Date('2026-02-02T00:00:00Z');
    expect(datiFunnel('S0', { ...storico, firmate: 1, primaPraticaAt: prima })).toEqual({
      status: 'S8',
      platStatus: 'ATTIVO',
      primaPratica: true,
      primaPraticaAt: prima,
    });
  });

  it('azienda sospesa o cancellata: SOSPESO anche se ha firmato', () => {
    expect(
      datiFunnel('S0', { ...storico, firmate: 3, sospesa: true }).platStatus,
    ).toBe('SOSPESO');
  });
});
