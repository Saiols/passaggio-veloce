import { describe, it, expect } from 'vitest';
import { serveAggiornareFestivi } from './festivi-avviso';

const OGGI = new Date(Date.UTC(2026, 6, 26, 10, 0)); // 26 luglio 2026

describe('serveAggiornareFestivi', () => {
  it('lista vuota → avviso', () => {
    expect(serveAggiornareFestivi([], OGGI)).toBe(true);
  });

  it('solo festivi passati → avviso', () => {
    expect(serveAggiornareFestivi([{ data: '2026-01-01', nome: 'Capodanno' }], OGGI)).toBe(true);
  });

  it('un festivo entro i 60 giorni → nessun avviso', () => {
    expect(serveAggiornareFestivi([{ data: '2026-08-15', nome: 'Ferragosto' }], OGGI)).toBe(false);
  });

  it('festivi tutti oltre i 60 giorni → avviso: la copertura vicina manca', () => {
    expect(serveAggiornareFestivi([{ data: '2026-12-25', nome: 'Natale' }], OGGI)).toBe(true);
  });

  it('il confine si valuta sul giorno di Roma', () => {
    // 2026-09-24 è a 60 giorni esatti dal 26 luglio: dentro la finestra.
    expect(serveAggiornareFestivi([{ data: '2026-09-24', nome: 'X' }], OGGI)).toBe(false);
    expect(serveAggiornareFestivi([{ data: '2026-09-25', nome: 'X' }], OGGI)).toBe(true);
  });
});
