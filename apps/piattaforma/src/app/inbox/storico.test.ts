import { describe, it, expect } from 'vitest';
import { labelEsito, STORICO_ESITI, storicoCutoff, STORICO_GIORNI } from './storico';

describe('storico decisioni inbox', () => {
  it('include sia le accettate sia le rifiutate (incl. assegnate ad altra agenzia e scadute)', () => {
    expect(STORICO_ESITI).toContain('ACCETTATA');
    expect(STORICO_ESITI).toContain('RIFIUTATA');
    expect(STORICO_ESITI).toContain('ASSEGNATA_ALTRO');
    expect(STORICO_ESITI).toContain('TIMEOUT');
  });

  it('etichetta ACCETTATA come "Accettata"', () => {
    expect(labelEsito('ACCETTATA')).toBe('Accettata');
  });

  it('etichetta come "Rifiutata" sia RIFIUTATA sia ASSEGNATA_ALTRO (non più "Ad altra")', () => {
    expect(labelEsito('RIFIUTATA')).toBe('Rifiutata');
    expect(labelEsito('ASSEGNATA_ALTRO')).toBe('Rifiutata');
  });

  it('etichetta TIMEOUT come "Scaduta"', () => {
    expect(labelEsito('TIMEOUT')).toBe('Scaduta');
  });

  it('storicoCutoff è esattamente 7 giorni prima di adesso', () => {
    expect(STORICO_GIORNI).toBe(7);
    const now = new Date('2026-06-29T12:00:00.000Z');
    expect(storicoCutoff(now).toISOString()).toBe('2026-06-22T12:00:00.000Z');
  });
});
