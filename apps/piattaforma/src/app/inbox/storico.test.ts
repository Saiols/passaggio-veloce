import { describe, it, expect } from 'vitest';
import {
  labelEsito,
  vintaDaAltri,
  STORICO_ESITI,
  storicoCutoff,
  STORICO_GIORNI,
} from './storico';

/** Nostra assegnazione: ciclo 1, chiusa senza che accettassimo. */
const CICLO_NOSTRO = 1;

describe('storico decisioni inbox', () => {
  it('include sia le accettate sia le rifiutate (incl. assegnate ad altra agenzia e scadute)', () => {
    expect(STORICO_ESITI).toContain('ACCETTATA');
    expect(STORICO_ESITI).toContain('RIFIUTATA');
    expect(STORICO_ESITI).toContain('ASSEGNATA_ALTRO');
    expect(STORICO_ESITI).toContain('TIMEOUT');
  });

  it('etichetta ACCETTATA come "Accettata"', () => {
    expect(labelEsito('ACCETTATA', { vintaDaAltri: false })).toBe('Accettata');
  });

  it('"Rifiutata" solo sul rifiuto esplicito: è l’unico caso in cui la decisione è stata nostra', () => {
    expect(labelEsito('RIFIUTATA', { vintaDaAltri: false })).toBe('Rifiutata');
    expect(labelEsito('RIFIUTATA', { vintaDaAltri: true })).toBe('Rifiutata');
  });

  it('ASSEGNATA_ALTRO con un’altra accettazione nel ciclo → "Persa"', () => {
    expect(labelEsito('ASSEGNATA_ALTRO', { vintaDaAltri: true })).toBe('Persa');
  });

  it('ASSEGNATA_ALTRO senza nessuna accettazione → "Annullata" (la pratica è stata chiusa, non l’abbiamo persa)', () => {
    expect(labelEsito('ASSEGNATA_ALTRO', { vintaDaAltri: false })).toBe('Annullata');
  });

  it('etichetta TIMEOUT come "Scaduta"', () => {
    expect(labelEsito('TIMEOUT', { vintaDaAltri: false })).toBe('Scaduta');
  });

  it('storicoCutoff è esattamente 7 giorni prima di adesso', () => {
    expect(STORICO_GIORNI).toBe(7);
    const now = new Date('2026-06-29T12:00:00.000Z');
    expect(storicoCutoff(now).toISOString()).toBe('2026-06-22T12:00:00.000Z');
  });
});

describe('vintaDaAltri', () => {
  it('un’altra agenzia ha accettato nel nostro ciclo → true', () => {
    expect(
      vintaDaAltri(CICLO_NOSTRO, [
        { ciclo: 1, esito: 'ASSEGNATA_ALTRO' }, // la nostra
        { ciclo: 1, esito: 'ACCETTATA' },
      ]),
    ).toBe(true);
  });

  it('nessuno ha accettato (pratica annullata mentre girava) → false', () => {
    expect(
      vintaDaAltri(CICLO_NOSTRO, [
        { ciclo: 1, esito: 'ASSEGNATA_ALTRO' },
        { ciclo: 1, esito: 'ASSEGNATA_ALTRO' },
        { ciclo: 1, esito: 'RIFIUTATA' },
      ]),
    ).toBe(false);
  });

  it('l’accettazione è di un ALTRO ciclo → false: quel giro non è il nostro', () => {
    expect(
      vintaDaAltri(CICLO_NOSTRO, [
        { ciclo: 1, esito: 'ASSEGNATA_ALTRO' },
        { ciclo: 2, esito: 'ACCETTATA' },
      ]),
    ).toBe(false);
  });

  it('accettazione poi revocata dall’admin → true: quando ci siamo chiusi, la pratica era di un altro', () => {
    // Scenario reale del ricircolo: la revoca sgancia l'agenzia dalla pratica e
    // apre il ciclo 2. Guardando `agenziaAssegnataId` la pratica sembrerebbe di
    // nessuno e la nostra riga si etichetterebbe "Annullata".
    expect(
      vintaDaAltri(CICLO_NOSTRO, [
        { ciclo: 1, esito: 'ASSEGNATA_ALTRO' },
        { ciclo: 1, esito: 'REVOCATA_ADMIN' },
        { ciclo: 2, esito: 'PENDING' },
      ]),
    ).toBe(true);
  });

  it('nessuna assegnazione sorella → false, senza lanciare', () => {
    expect(vintaDaAltri(CICLO_NOSTRO, [])).toBe(false);
  });
});
