import { describe, it, expect } from 'vitest';
import { PraticaStato } from '@pv/db';
import {
  STATI_IN_ATTESA,
  STATI_IN_CORSO,
  STATI_CONCLUSI,
  SINGOLI,
  isInCorso,
  whereStato,
  contaGruppi,
} from './stati';

// Tutti i valori dell'enum Prisma, presi dall'enum stesso: se domani ne viene
// aggiunto uno, questa lista cresce da sola e i test sotto lo intercettano.
const TUTTI = Object.values(PraticaStato) as PraticaStato[];

describe('partizione degli stati', () => {
  // L'invariante che conta: uno stato nuovo aggiunto all'enum e non classificato
  // sparirebbe in silenzio dai tab e dai conteggi. Qui il test diventa rosso.
  it.each(TUTTI)('%s cade in esattamente un gruppo', (stato) => {
    const gruppi = [
      stato === 'BOZZA',
      (STATI_IN_CORSO as readonly PraticaStato[]).includes(stato),
      (STATI_CONCLUSI as readonly PraticaStato[]).includes(stato),
    ].filter(Boolean).length;
    expect(gruppi).toBe(1);
  });

  it('i gruppi non si sovrappongono', () => {
    const overlap = STATI_IN_CORSO.filter((s) =>
      (STATI_CONCLUSI as readonly PraticaStato[]).includes(s),
    );
    expect(overlap).toEqual([]);
  });

  // Seconda classificazione, indipendente dalla prima: quali stati sono
  // selezionabili uno per uno dalla UI (SINGOLI) contro quali sono dettagli
  // interni al motore di distribuzione (STATI_IN_ATTESA). Senza questo test
  // un nuovo stato aggiunto all'enum e classificato in STATI_IN_CORSO/
  // STATI_CONCLUSI passerebbe il test sopra ma resterebbe fuori da SINGOLI
  // senza che nulla lo segnali: whereStato(nuovoStato) tornerebbe undefined
  // (nessun filtro) in silenzio, lo stesso bug che questo modulo esiste per
  // eliminare.
  it.each(TUTTI)('%s cade in esattamente uno tra SINGOLI e STATI_IN_ATTESA', (stato) => {
    const gruppi = [
      (STATI_IN_ATTESA as readonly PraticaStato[]).includes(stato),
      (SINGOLI as readonly PraticaStato[]).includes(stato),
    ].filter(Boolean).length;
    expect(gruppi).toBe(1);
  });

  it('SINGOLI e STATI_IN_ATTESA non si sovrappongono', () => {
    const overlap = SINGOLI.filter((s) => (STATI_IN_ATTESA as readonly PraticaStato[]).includes(s));
    expect(overlap).toEqual([]);
  });
});

describe('isInCorso', () => {
  it('la bozza non è in corso: non è ancora stata inviata', () => {
    expect(isInCorso('BOZZA')).toBe(false);
  });

  it("l'escalation è in corso: la pratica è viva, la sta assegnando il team", () => {
    expect(isInCorso('IN_ESCALATION')).toBe(true);
  });

  it('accettata e processata sono in corso', () => {
    expect(isInCorso('ACCETTATA')).toBe(true);
    expect(isInCorso('PROCESSATA')).toBe(true);
  });

  it('firmata, annullata e scaduta non sono in corso: sono terminali', () => {
    expect(isInCorso('FIRMATA')).toBe(false);
    expect(isInCorso('ANNULLATA')).toBe(false);
    expect(isInCorso('SCADUTA')).toBe(false);
  });
});

describe('whereStato', () => {
  it('senza parametro non filtra nulla', () => {
    expect(whereStato(undefined)).toBeUndefined();
    expect(whereStato('')).toBeUndefined();
  });

  it('un valore non riconosciuto non filtra nulla (niente lista vuota a sorpresa)', () => {
    expect(whereStato('PIPPO')).toBeUndefined();
  });

  it('IN_CORSO espande sui 6 stati vivi', () => {
    expect(whereStato('IN_CORSO')).toEqual({ in: [...STATI_IN_CORSO] });
  });

  it('CONCLUSE espande sui 3 stati terminali', () => {
    expect(whereStato('CONCLUSE')).toEqual({ in: [...STATI_CONCLUSI] });
  });

  it('IN_ATTESA espande sui round + escalation (aggregato già esistente)', () => {
    expect(whereStato('IN_ATTESA')).toEqual({
      in: ['IN_ATTESA_ROUND_1', 'IN_ATTESA_ROUND_2', 'IN_ATTESA_ROUND_3', 'IN_ESCALATION'],
    });
  });

  it('uno stato singolo filtra per uguaglianza', () => {
    expect(whereStato('PROCESSATA')).toBe('PROCESSATA');
  });

  it('gli altri stati singoli filtrano per uguaglianza', () => {
    expect(whereStato('BOZZA')).toBe('BOZZA');
    expect(whereStato('ACCETTATA')).toBe('ACCETTATA');
    expect(whereStato('FIRMATA')).toBe('FIRMATA');
    expect(whereStato('SCADUTA')).toBe('SCADUTA');
    expect(whereStato('ANNULLATA')).toBe('ANNULLATA');
  });

  it('gli stati interni del motore non sono selezionabili dall utente', () => {
    // R1/R2/R3 ed escalation non sono esposti singolarmente nella UI utente:
    // passarli a mano nell'URL non deve produrre un filtro.
    expect(whereStato('IN_ATTESA_ROUND_2')).toBeUndefined();
    expect(whereStato('IN_ESCALATION')).toBeUndefined();
  });
});

describe('contaGruppi', () => {
  it('somma i conteggi Prisma nei quattro gruppi dei tab', () => {
    const rows = [
      { stato: 'BOZZA' as PraticaStato, _count: { _all: 2 } },
      { stato: 'IN_ATTESA_ROUND_1' as PraticaStato, _count: { _all: 3 } },
      { stato: 'ACCETTATA' as PraticaStato, _count: { _all: 1 } },
      { stato: 'FIRMATA' as PraticaStato, _count: { _all: 4 } },
      { stato: 'ANNULLATA' as PraticaStato, _count: { _all: 1 } },
    ];
    expect(contaGruppi(rows)).toEqual({ tutte: 11, inCorso: 4, bozze: 2, concluse: 5 });
  });

  it('senza righe è tutto a zero', () => {
    expect(contaGruppi([])).toEqual({ tutte: 0, inCorso: 0, bozze: 0, concluse: 0 });
  });
});
