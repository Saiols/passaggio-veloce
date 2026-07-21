import { describe, it, expect } from 'vitest';
import { PraticaStato } from '@pv/db';
import {
  STATI_IN_ATTESA,
  STATI_IN_DISTRIBUZIONE,
  STATI_IN_CORSO,
  STATI_CONCLUSI,
  SINGOLI,
  SINGOLI_ADMIN,
  isInCorso,
  whereStato,
  contaGruppi,
  whereTabPratiche,
  WHERE_ATTESA_FIRMA,
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

describe('STATI_IN_DISTRIBUZIONE', () => {
  // Le card admin (dashboard, demo-control) affiancano "In distribuzione" ed
  // "Escalation" come due contatori distinti: se l'escalation finisse anche
  // qui dentro, verrebbe sommata due volte tra le due card. Per questo
  // STATI_IN_DISTRIBUZIONE è STATI_IN_ATTESA MENO l'escalation, non lo stesso
  // insieme (a differenza di contaGruppi/tab utente, dove l'escalation è
  // trasversale e resta dentro "in attesa"/"in corso").
  it('non include IN_ESCALATION', () => {
    expect(STATI_IN_DISTRIBUZIONE).not.toContain('IN_ESCALATION');
  });

  it('include i round legacy e il motore v2', () => {
    expect(STATI_IN_DISTRIBUZIONE).toEqual(
      expect.arrayContaining([
        'IN_ATTESA_ROUND_1',
        'IN_ATTESA_ROUND_2',
        'IN_ATTESA_ROUND_3',
        'IN_DISTRIBUZIONE',
      ]),
    );
  });

  it('è esattamente STATI_IN_ATTESA meno IN_ESCALATION', () => {
    const atteso = STATI_IN_ATTESA.filter((s) => s !== 'IN_ESCALATION');
    expect([...STATI_IN_DISTRIBUZIONE].sort()).toEqual([...atteso].sort());
  });
});

describe('isInCorso', () => {
  it('la bozza non è in corso: non è ancora stata inviata', () => {
    expect(isInCorso('BOZZA')).toBe(false);
  });

  it("l'escalation è in corso: la pratica è viva, la sta assegnando il team", () => {
    expect(isInCorso('IN_ESCALATION')).toBe(true);
  });

  it('IN_DISTRIBUZIONE (motore v2) è in corso: sostituisce i round legacy', () => {
    expect(isInCorso('IN_DISTRIBUZIONE')).toBe(true);
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

  it('IN_ATTESA espande sui round + escalation + distribuzione v2 (aggregato già esistente)', () => {
    expect(whereStato('IN_ATTESA')).toEqual({
      in: [
        'IN_ATTESA_ROUND_1',
        'IN_ATTESA_ROUND_2',
        'IN_ATTESA_ROUND_3',
        'IN_ESCALATION',
        'IN_DISTRIBUZIONE',
      ],
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
    // passarli a mano nell'URL non deve produrre un filtro. Lo stesso vale per
    // IN_DISTRIBUZIONE (motore v2): è un dettaglio interno, non un valore che
    // il broker/agenzia sceglie dalla select.
    expect(whereStato('IN_ATTESA_ROUND_2')).toBeUndefined();
    expect(whereStato('IN_ESCALATION')).toBeUndefined();
    expect(whereStato('IN_DISTRIBUZIONE')).toBeUndefined();
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
    expect(contaGruppi(rows)).toEqual({ tutte: 11, inCorso: 4, escalation: 0, bozze: 2, concluse: 5 });
  });

  it('senza righe è tutto a zero', () => {
    expect(contaGruppi([])).toEqual({ tutte: 0, inCorso: 0, escalation: 0, bozze: 0, concluse: 0 });
  });
});

describe('whereStato con insieme admin', () => {
  // La regressione che questo test esiste per impedire: l'admin filtra oggi con
  // un match esatto e quindi IN_ESCALATION funziona. Passando a whereStato con
  // l'insieme di default (SINGOLI, pensato per il broker), tornerebbe undefined
  // = nessun filtro: la select direbbe "Escalation" e la lista mostrerebbe
  // tutto. Silenzioso, e quindi peggio di un errore.
  it.each(['IN_ESCALATION', 'IN_ATTESA_ROUND_1', 'IN_ATTESA_ROUND_2', 'IN_ATTESA_ROUND_3', 'IN_DISTRIBUZIONE'])(
    '%s filtra davvero con SINGOLI_ADMIN (e non filtrerebbe con SINGOLI)',
    (stato) => {
      expect(whereStato(stato, SINGOLI_ADMIN)).toBe(stato);
      expect(whereStato(stato)).toBeUndefined();
    },
  );

  it('SINGOLI_ADMIN copre ogni valore dell’enum', () => {
    for (const s of TUTTI) {
      expect(SINGOLI_ADMIN).toContain(s);
    }
  });

  it('gli aggregati continuano a funzionare con l’insieme admin', () => {
    expect(whereStato('IN_CORSO', SINGOLI_ADMIN)).toEqual({ in: [...STATI_IN_CORSO] });
  });

  it('un valore non riconosciuto non filtra, nemmeno per l’admin', () => {
    expect(whereStato('PIPPO', SINGOLI_ADMIN)).toBeUndefined();
  });
});

describe('whereTabPratiche', () => {
  it('ATTESA_FIRMA = processata E non segnalata', () => {
    // Non basta lo stato: una PROCESSATA con segnalazione aperta è ferma in
    // coda admin, non in attesa di firma.
    expect(whereTabPratiche('ATTESA_FIRMA', SINGOLI_ADMIN)).toEqual({
      stato: 'PROCESSATA',
      flagSegnalata: false,
    });
  });

  it('delega a whereStato per gli aggregati', () => {
    expect(whereTabPratiche('IN_CORSO', SINGOLI_ADMIN)).toEqual({
      stato: { in: [...STATI_IN_CORSO] },
    });
  });

  it('delega a whereStato per gli stati singoli', () => {
    expect(whereTabPratiche('PROCESSATA', SINGOLI_ADMIN)).toEqual({ stato: 'PROCESSATA' });
  });

  it('nessun parametro → nessun filtro', () => {
    expect(whereTabPratiche(undefined, SINGOLI_ADMIN)).toEqual({});
  });

  it('valore ignoto → nessun filtro (come whereStato)', () => {
    expect(whereTabPratiche('PIPPO', SINGOLI_ADMIN)).toEqual({});
  });

  it('ATTESA_FIRMA non è uno stato: whereStato da sola non lo filtrerebbe', () => {
    // Questo è il motivo per cui whereTabPratiche esiste. Se qualcuno usasse
    // whereStato per il tab, vedrebbe TUTTE le pratiche senza alcun errore.
    expect(whereStato('ATTESA_FIRMA', SINGOLI_ADMIN)).toBeUndefined();
  });

  it('WHERE_ATTESA_FIRMA è il criterio grezzo usato dal chiamante per il conteggio', () => {
    expect(WHERE_ATTESA_FIRMA).toEqual({ stato: 'PROCESSATA', flagSegnalata: false });
  });
});

describe('conteggio escalation', () => {
  it('escalation è un sottoinsieme di inCorso e non è sommato due volte in tutte', () => {
    const c = contaGruppi([
      { stato: 'IN_ESCALATION', _count: { _all: 2 } },
      { stato: 'ACCETTATA', _count: { _all: 3 } },
      { stato: 'BOZZA', _count: { _all: 1 } },
      { stato: 'FIRMATA', _count: { _all: 4 } },
    ]);
    expect(c.escalation).toBe(2);
    expect(c.inCorso).toBe(5); // escalation + accettata
    expect(c.bozze).toBe(1);
    expect(c.concluse).toBe(4);
    expect(c.tutte).toBe(10); // NON 12: l'escalation è già dentro inCorso
  });
});
