import { describe, it, expect } from 'vitest';
import {
  documentiRichiestiParte,
  verificaIdentita,
  verificaVisura,
  verificaPermesso,
  verificaCodiceFiscale,
  validaParte,
  type ParteDati,
} from './parte-docs';

const NOW = new Date('2026-06-06T12:00:00Z');

const PRIVATO: ParteDati = {
  isPersonaGiuridica: false,
  tipoSoggetto: 'PRIVATO_ITALIANO',
  nome: 'Mario',
  cognome: 'Rossi',
  cf: 'RSSMRA80A01F205Z',
};
const STRANIERO: ParteDati = {
  isPersonaGiuridica: false,
  tipoSoggetto: 'STRANIERO_EXTRA_UE',
  nome: 'John',
  cognome: 'Smith',
};
const AZIENDA: ParteDati = {
  isPersonaGiuridica: true,
  tipoSoggetto: 'AZIENDA',
  ragioneSociale: 'Auto Veloci SRL',
  piva: '12345678901',
};

describe('documentiRichiestiParte', () => {
  it('privato + CI (default elettronica) → identità, niente CF', () => {
    expect(documentiRichiestiParte(PRIVATO)).toEqual({
      identita: true, visura: false, permesso: false, codiceFiscale: false,
    });
  });
  it('privato + CI elettronica esplicita → niente CF', () => {
    expect(
      documentiRichiestiParte({ ...PRIVATO, ciTipo: 'ELETTRONICA' }).codiceFiscale,
    ).toBe(false);
  });
  it('privato + CI cartacea → CF richiesto', () => {
    expect(
      documentiRichiestiParte({ ...PRIVATO, ciTipo: 'CARTACEA' }).codiceFiscale,
    ).toBe(true);
  });
  it('privato + passaporto → CF richiesto (ciTipo ininfluente)', () => {
    expect(documentiRichiestiParte({ ...PRIVATO, documentoIdentita: 'PASSAPORTO' }).codiceFiscale).toBe(true);
  });
  it('privato + patente → CF richiesto', () => {
    expect(documentiRichiestiParte({ ...PRIVATO, documentoIdentita: 'PATENTE' }).codiceFiscale).toBe(true);
  });
  it('straniero (default CI) → identità + permesso + CF', () => {
    expect(documentiRichiestiParte(STRANIERO)).toEqual({
      identita: true, visura: false, permesso: true, codiceFiscale: true,
    });
  });
  it('azienda rep CI → identità + visura, niente CF', () => {
    expect(documentiRichiestiParte(AZIENDA)).toEqual({
      identita: true, visura: true, permesso: false, codiceFiscale: false,
    });
    expect(documentiRichiestiParte({ ...AZIENDA, tipoSoggetto: 'OPERATORE_AUTO' }).visura).toBe(true);
  });
  it('azienda rep passaporto → CF richiesto', () => {
    expect(documentiRichiestiParte({ ...AZIENDA, documentoIdentita: 'PASSAPORTO' }).codiceFiscale).toBe(true);
  });
});

describe('verificaIdentita', () => {
  it('CF uguale → MATCH (chiave forte)', () => {
    expect(verificaIdentita(PRIVATO, { nome: 'X', cognome: 'Y', codiceFiscale: 'rssmra80a01f205z' })).toBe('MATCH');
  });
  it('CF diverso → MISMATCH', () => {
    expect(verificaIdentita(PRIVATO, { codiceFiscale: 'BNCLNZ70A01F205X' })).toBe('MISMATCH');
  });
  it('senza CF estratto → match sul nome', () => {
    expect(verificaIdentita(PRIVATO, { nome: 'Mario', cognome: 'Rossi' })).toBe('MATCH');
    expect(verificaIdentita(PRIVATO, { nome: 'Luca', cognome: 'Bianchi' })).toBe('MISMATCH');
  });
  it('niente estratto → ILLEGGIBILE', () => {
    expect(verificaIdentita(PRIVATO, undefined)).toBe('ILLEGGIBILE');
    expect(verificaIdentita(PRIVATO, {})).toBe('ILLEGGIBILE');
  });
});

describe('verificaVisura', () => {
  const fresca = { partitaIva: '12345678901', denominazione: 'Auto Veloci SRL', dataEmissione: '2026-05-01' };
  it('P.IVA uguale + fresca → MATCH', () => {
    expect(verificaVisura(AZIENDA, fresca, NOW)).toBe('MATCH');
  });
  it('azienda diversa → MISMATCH', () => {
    expect(verificaVisura(AZIENDA, { partitaIva: '99999999999', denominazione: 'Altra SPA', dataEmissione: '2026-05-01' }, NOW)).toBe('MISMATCH');
  });
  it('match ma visura > 6 mesi → SCADUTO', () => {
    expect(verificaVisura(AZIENDA, { ...fresca, dataEmissione: '2025-11-01' }, NOW)).toBe('SCADUTO');
  });
  it('match ma senza data → ILLEGGIBILE (fail-closed sulla freschezza)', () => {
    expect(verificaVisura(AZIENDA, { partitaIva: '12345678901' }, NOW)).toBe('ILLEGGIBILE');
  });
  it('niente estratto → ILLEGGIBILE', () => {
    expect(verificaVisura(AZIENDA, undefined, NOW)).toBe('ILLEGGIBILE');
  });
  it('requireFreshness=false: visura > 6 mesi → MATCH (niente controllo data)', () => {
    expect(
      verificaVisura(AZIENDA, { ...fresca, dataEmissione: '2025-11-01' }, NOW, { requireFreshness: false }),
    ).toBe('MATCH');
  });
  it('requireFreshness=false: senza data → MATCH (niente controllo data)', () => {
    expect(
      verificaVisura(AZIENDA, { partitaIva: '12345678901', denominazione: 'Auto Veloci SRL' }, NOW, {
        requireFreshness: false,
      }),
    ).toBe('MATCH');
  });
  it('requireFreshness=false ma azienda diversa → MISMATCH (il match resta)', () => {
    expect(
      verificaVisura(AZIENDA, { partitaIva: '99999999999', denominazione: 'Altra SPA' }, NOW, {
        requireFreshness: false,
      }),
    ).toBe('MISMATCH');
  });
});

describe('verificaPermesso', () => {
  it('nome match + non scaduto → MATCH', () => {
    expect(verificaPermesso(STRANIERO, { nome: 'John', cognome: 'Smith', scadenza: '2027-01-01' }, NOW)).toBe('MATCH');
  });
  it('persona diversa → MISMATCH', () => {
    expect(verificaPermesso(STRANIERO, { nome: 'Ahmed', cognome: 'Ali', scadenza: '2027-01-01' }, NOW)).toBe('MISMATCH');
  });
  it('scaduto → SCADUTO', () => {
    expect(verificaPermesso(STRANIERO, { nome: 'John', cognome: 'Smith', scadenza: '2025-01-01' }, NOW)).toBe('SCADUTO');
  });
  it('senza scadenza → ILLEGGIBILE', () => {
    expect(verificaPermesso(STRANIERO, { nome: 'John', cognome: 'Smith' }, NOW)).toBe('ILLEGGIBILE');
  });
});

describe('validaParte (fail-closed)', () => {
  it('privato con CI corrispondente → ok', () => {
    const r = validaParte(PRIVATO, { identita: { codiceFiscale: 'RSSMRA80A01F205Z' } }, NOW);
    expect(r.ok).toBe(true);
    expect(r.problemi).toEqual([]);
  });
  it('privato senza documento → blocco', () => {
    expect(validaParte(PRIVATO, {}, NOW).ok).toBe(false);
  });
  it('privato con CI di altra persona → blocco', () => {
    const r = validaParte(PRIVATO, { identita: { codiceFiscale: 'BNCLNZ70A01F205X' } }, NOW);
    expect(r.ok).toBe(false);
    expect(r.problemi[0]).toMatch(/non corrisponde/);
  });
  it('straniero: identità ok ma permesso mancante → blocco', () => {
    const r = validaParte(STRANIERO, { identita: { nome: 'John', cognome: 'Smith' } }, NOW);
    expect(r.ok).toBe(false);
    expect(r.problemi.join(' ')).toMatch(/Permesso/);
  });
  it('straniero: identità + permesso + CF validi → ok', () => {
    const r = validaParte(
      STRANIERO,
      {
        identita: { nome: 'John', cognome: 'Smith' },
        permesso: { nome: 'John', cognome: 'Smith', scadenza: '2027-01-01' },
        codiceFiscale: { codiceFiscale: 'SMTJHN80A01Z404X' },
      },
      NOW,
    );
    expect(r.ok).toBe(true);
  });
  it('azienda: visura corrispondente + CI presente → ok', () => {
    const r = validaParte(
      AZIENDA,
      {
        identita: { nome: 'Mario', cognome: 'Rossi' },
        visura: { partitaIva: '12345678901', denominazione: 'Auto Veloci SRL', dataEmissione: '2026-05-01' },
      },
      NOW,
    );
    expect(r.ok).toBe(true);
  });
  it('azienda: visura di altra società → blocco', () => {
    const r = validaParte(
      AZIENDA,
      {
        identita: { nome: 'Mario', cognome: 'Rossi' },
        visura: { partitaIva: '99999999999', denominazione: 'Altra SPA', dataEmissione: '2026-05-01' },
      },
      NOW,
    );
    expect(r.ok).toBe(false);
  });
  it('azienda: CI non corrisponde al legale rappresentante della visura → blocco', () => {
    const r = validaParte(
      AZIENDA,
      {
        identita: { nome: 'Luca', cognome: 'Bianchi', codiceFiscale: 'BNCLCU70A01F205X' },
        visura: {
          partitaIva: '12345678901',
          denominazione: 'Auto Veloci SRL',
          dataEmissione: '2026-05-01',
          amministratore: { nome: 'Mario', cognome: 'Rossi', codiceFiscale: 'RSSMRA80A01F205Z' },
        },
      },
      NOW,
    );
    expect(r.ok).toBe(false);
    expect(r.problemi.join(' ')).toMatch(/rappresentante/);
  });
});

describe('validaParte — gate ATECO acquirente operatore auto (minivoltura)', () => {
  // Acquirente di una minivoltura: sempre OPERATORE_AUTO (commerciante auto =
  // profilo DEALER). Il gate ATECO confronta i codici della visura con
  // l'allowlist DEALER, esattamente come in registrazione.
  const OPERATORE: ParteDati = {
    isPersonaGiuridica: true,
    tipoSoggetto: 'OPERATORE_AUTO',
    ragioneSociale: 'Auto Veloci SRL',
    piva: '12345678901',
  };
  const ALLOWED_DEALER = [
    { companyType: 'DEALER' as const, code: '4511', active: true },
    { companyType: 'DEALER' as const, code: '4781', active: true },
  ];
  // Visura che supera già gli altri controlli (P.IVA + denominazione + freschezza)
  // e identità del rappresentante presente: così il blocco dipende solo dall'ATECO.
  const ocrConAteco = (atecoCodes?: string[]) => ({
    identita: { nome: 'Mario', cognome: 'Rossi' },
    visura: {
      partitaIva: '12345678901',
      denominazione: 'Auto Veloci SRL',
      dataEmissione: '2026-05-01',
      atecoCodes,
    },
  });

  // L'acquirente minivoltura DEVE essere commerciante d'auto: flag dedicato.
  const MINI = { atecoAllowed: ALLOWED_DEALER, richiedeOperatoreAuto: true };

  it('codice ATECO ammesso → ok', () => {
    const r = validaParte(OPERATORE, ocrConAteco(['45.11.01']), NOW, MINI);
    expect(r.ok).toBe(true);
    expect(r.problemi).toEqual([]);
  });

  it('basta che UNO dei codici della visura sia ammesso → ok', () => {
    const r = validaParte(OPERATORE, ocrConAteco(['62.01.00', '47.81.10']), NOW, MINI);
    expect(r.ok).toBe(true);
  });

  it('nessun codice ATECO ammesso → blocco con i codici nel messaggio', () => {
    const r = validaParte(OPERATORE, ocrConAteco(['62.01.00', '70.22.09']), NOW, MINI);
    expect(r.ok).toBe(false);
    expect(r.problemi.join(' ')).toMatch(/ATECO/);
    expect(r.problemi.join(' ')).toMatch(/62\.01\.00/);
  });

  it('visura senza ATECO estraibile → BLOCCO fail-closed per l\'acquirente minivoltura (bug #13)', () => {
    // Prima passava (fail-open): una visura leggibile ma con ATECO non estratto
    // accreditava un commerciante mai confermato. Ora blocca.
    const r1 = validaParte(OPERATORE, ocrConAteco([]), NOW, MINI);
    expect(r1.ok).toBe(false);
    expect(r1.problemi.join(' ')).toMatch(/ATECO/);
    expect(validaParte(OPERATORE, ocrConAteco(undefined), NOW, MINI).ok).toBe(false);
  });

  it('senza richiedeOperatoreAuto → il gate ATECO non blocca', () => {
    const r = validaParte(OPERATORE, ocrConAteco(['62.01.00']), NOW, { atecoAllowed: ALLOWED_DEALER });
    expect(r.ok).toBe(true);
  });

  it('parte AZIENDA (non operatore auto) → ATECO mai bloccante anche con allowlist', () => {
    const r = validaParte({ ...AZIENDA }, ocrConAteco(['62.01.00']), NOW, {
      atecoAllowed: ALLOWED_DEALER,
    });
    expect(r.ok).toBe(true);
  });

  // --- Freshness ≤6 mesi condizionata all'essere commerciante d'auto ---
  const visuraVecchia = (atecoCodes?: string[]) => ({
    identita: { nome: 'Mario', cognome: 'Rossi' },
    visura: {
      partitaIva: '12345678901',
      denominazione: 'Auto Veloci SRL',
      dataEmissione: '2025-11-01', // > 6 mesi prima di NOW (2026-06-06)
      atecoCodes,
    },
  });

  it('commerciante (ATECO dealer) con visura vecchia → SCADUTO', () => {
    const r = validaParte(OPERATORE, visuraVecchia(['45.11.01']), NOW, MINI);
    expect(r.ok).toBe(false);
    expect(r.problemi.join(' ')).toMatch(/non superiore agli ultimi 6 mesi/i);
  });

  it('acquirente minivoltura: visura vecchia → SCADUTO anche se ATECO non estraibile', () => {
    const r = validaParte(OPERATORE, visuraVecchia([]), NOW, MINI);
    expect(r.ok).toBe(false);
    expect(r.problemi.join(' ')).toMatch(/non superiore agli ultimi 6 mesi/i);
  });

  it('società NON commerciante: visura vecchia → ok (niente controllo data)', () => {
    const r = validaParte(AZIENDA, visuraVecchia(['62.01.00']), NOW, { atecoAllowed: ALLOWED_DEALER });
    expect(r.ok).toBe(true);
  });

  it('società con ATECO non estraibile (non confermata commerciante): visura vecchia → ok', () => {
    const r = validaParte(AZIENDA, visuraVecchia(undefined), NOW, { atecoAllowed: ALLOWED_DEALER });
    expect(r.ok).toBe(true);
  });
});

describe('verificaCodiceFiscale', () => {
  it('CF estratto uguale a quello inserito → MATCH', () => {
    expect(verificaCodiceFiscale('RSSMRA80A01F205Z', { codiceFiscale: 'rssmra80a01f205z' })).toBe('MATCH');
  });
  it('CF estratto diverso → MISMATCH', () => {
    expect(verificaCodiceFiscale('RSSMRA80A01F205Z', { codiceFiscale: 'BNCLNZ70A01F205X' })).toBe('MISMATCH');
  });
  it('niente CF estratto → ILLEGGIBILE', () => {
    expect(verificaCodiceFiscale('RSSMRA80A01F205Z', undefined)).toBe('ILLEGGIBILE');
    expect(verificaCodiceFiscale('RSSMRA80A01F205Z', {})).toBe('ILLEGGIBILE');
  });
  it('CF atteso assente (rep PG senza CF anagrafico) ma estratto leggibile → MATCH', () => {
    expect(verificaCodiceFiscale(undefined, { codiceFiscale: 'RSSMRA80A01F205Z' })).toBe('MATCH');
  });
});

describe('validaParte — tessera sanitaria / CF fail-closed', () => {
  const CARTACEA: ParteDati = {
    isPersonaGiuridica: false,
    tipoSoggetto: 'PRIVATO_ITALIANO',
    ciTipo: 'CARTACEA',
    documentoIdentita: 'CI',
    nome: 'Mario',
    cognome: 'Rossi',
    cf: 'RSSMRA80A01F205Z',
  };
  it('CF richiesto ma mancante → blocco', () => {
    const r = validaParte(CARTACEA, { identita: { codiceFiscale: 'RSSMRA80A01F205Z' } }, NOW);
    expect(r.ok).toBe(false);
    expect(r.problemi.join(' ')).toMatch(/Tessera sanitaria/);
  });
  it('CF presente ma di altra persona → blocco', () => {
    const r = validaParte(
      CARTACEA,
      { identita: { codiceFiscale: 'RSSMRA80A01F205Z' }, codiceFiscale: { codiceFiscale: 'BNCLNZ70A01F205X' } },
      NOW,
    );
    expect(r.ok).toBe(false);
    expect(r.problemi.join(' ')).toMatch(/Tessera sanitaria/);
  });
  it('CI + CF corrispondenti → ok', () => {
    const r = validaParte(
      CARTACEA,
      { identita: { codiceFiscale: 'RSSMRA80A01F205Z' }, codiceFiscale: { codiceFiscale: 'RSSMRA80A01F205Z' } },
      NOW,
    );
    expect(r.ok).toBe(true);
    expect(r.problemi).toEqual([]);
  });
  it('azienda rep passaporto: CF mancante → blocco', () => {
    const r = validaParte(
      { ...AZIENDA, documentoIdentita: 'PASSAPORTO' },
      {
        identita: { nome: 'Mario', cognome: 'Rossi' },
        visura: { partitaIva: '12345678901', denominazione: 'Auto Veloci SRL', dataEmissione: '2026-05-01' },
        // codiceFiscale intenzionalmente assente
      },
      NOW,
    );
    expect(r.ok).toBe(false);
    expect(r.problemi.join(' ')).toMatch(/Tessera sanitaria/);
  });
});
