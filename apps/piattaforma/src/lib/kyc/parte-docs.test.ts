import { describe, it, expect } from 'vitest';
import {
  documentiRichiestiParte,
  verificaIdentita,
  verificaVisura,
  verificaPermesso,
  validaParte,
  type ParteDati,
} from './parte-docs';

const NOW = new Date('2026-06-06T12:00:00Z');

const PRIVATO: ParteDati = {
  isPersonaGiuridica: false,
  tipoSoggetto: 'PRIVATO_ITALIANO_CIE',
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
  it('privato → solo identità', () => {
    expect(documentiRichiestiParte(PRIVATO)).toEqual({ identita: true, visura: false, permesso: false });
  });
  it('straniero → identità + permesso', () => {
    expect(documentiRichiestiParte(STRANIERO)).toEqual({ identita: true, visura: false, permesso: true });
  });
  it('azienda/operatore → identità + visura', () => {
    expect(documentiRichiestiParte(AZIENDA)).toEqual({ identita: true, visura: true, permesso: false });
    expect(documentiRichiestiParte({ ...AZIENDA, tipoSoggetto: 'OPERATORE_AUTO' }).visura).toBe(true);
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
  it('straniero: identità + permesso validi → ok', () => {
    const r = validaParte(
      STRANIERO,
      { identita: { nome: 'John', cognome: 'Smith' }, permesso: { nome: 'John', cognome: 'Smith', scadenza: '2027-01-01' } },
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
