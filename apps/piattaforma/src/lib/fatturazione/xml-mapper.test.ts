import { describe, it, expect } from 'vitest';
import { toFatturaPaInput, type DocumentoXmlInput } from './xml-mapper';
import type { DatiFiscali } from './pv-emittente';

const PV: DatiFiscali = {
  ragioneSociale: 'Passaggio Veloce S.r.l.',
  partitaIva: '12345678901',
  codiceSdi: 'PVSDI01',
  pec: 'pv@pec.it',
  indirizzo: 'Via Roma 1',
  cap: '20100',
  citta: 'Milano',
  provincia: 'MI',
};

const AGENZIA: DatiFiscali = {
  ragioneSociale: 'Agenzia Pratiche Auto S.r.l.',
  partitaIva: '98765432109',
  codiceSdi: 'ABCDEFG',
  pec: 'ag@pec.it',
  indirizzo: 'Corso Italia 22',
  cap: '10100',
  citta: 'Torino',
  provincia: 'TO',
};

const BROKER: DatiFiscali = {
  ragioneSociale: 'Autosalone Bianchi',
  partitaIva: '11122233344',
  codiceSdi: null,
  pec: 'bianchi@pec.it',
  indirizzo: 'Via Verdi 9',
  cap: '50100',
  citta: 'Firenze',
  provincia: 'FI',
};

function base(): DocumentoXmlInput {
  return {
    fatturaPaTipo: 'TD01',
    numero: '7/2026',
    numeroProgressivo: 7,
    data: new Date('2026-06-17T10:00:00Z'),
    emittente: PV,
    destinatario: AGENZIA,
    emittenteIsPv: true,
    imponibileCent: 4098,
    ivaCent: 902,
    aliquotaIvaPct: 22,
    descrizione: 'Servizio di intermediazione',
    pv: PV,
  };
}

describe('toFatturaPaInput — FATTURA_PV ordinaria', () => {
  it('cedente RF01, nessuna Natura, nessun terzo emittente', () => {
    const out = toFatturaPaInput(base());
    expect(out.cedentePrestatore.regimeFiscale).toBe('RF01');
    expect(out.cedentePrestatore.denominazione).toBe('Passaggio Veloce S.r.l.');
    expect(out.natura).toBeNull();
    expect(out.soggettoEmittenteTerzo).toBeNull();
  });

  it('cessionario porta il codice SDI del destinatario', () => {
    const out = toFatturaPaInput(base());
    expect(out.cessionarioCommittente.codiceDestinatario).toBe('ABCDEFG');
    expect(out.cessionarioCommittente.comune).toBe('Torino');
  });

  it('progressivoInvio = numero progressivo zero-padded; trasmittente = P.IVA PV', () => {
    const out = toFatturaPaInput(base());
    expect(out.progressivoInvio).toBe('00007');
    expect(out.idTrasmittente).toEqual({ idPaese: 'IT', idCodice: '12345678901' });
  });

  it('data convertita in formato ISO YYYY-MM-DD', () => {
    const out = toFatturaPaInput(base());
    expect(out.data).toBe('2026-06-17');
  });

  it('capodanno: la DataDocumento segue il calendario ITALIANO, non UTC', () => {
    // 23:30 UTC del 31 dicembre è già il 1° gennaio a Roma. `emessoAt` resta
    // l'istante UTC del `now()` del DB (emissione guidata da cron/webhook, non
    // più da un umano che firma): in quell'ora una FATTURA_PV numerata sul
    // registro 2027 non deve portare in XML la data UTC del 2026, altrimenti
    // il documento è internamente incoerente (numero e data su anni diversi).
    const out = toFatturaPaInput({ ...base(), data: new Date('2026-12-31T23:30:00Z') });
    expect(out.data).toBe('2027-01-01');
  });
});

describe('toFatturaPaInput — DOC_BROKER per conto terzi', () => {
  it('forfettario (aliquota 0): cedente RF19, Natura N2.2, terzo = PV', () => {
    const out = toFatturaPaInput({
      ...base(),
      fatturaPaTipo: 'TD06',
      emittente: BROKER,
      destinatario: PV,
      emittenteIsPv: false,
      imponibileCent: 2000,
      ivaCent: 0,
      aliquotaIvaPct: 0,
      descrizione: 'Compenso di intermediazione',
    });
    expect(out.cedentePrestatore.regimeFiscale).toBe('RF19');
    expect(out.natura).toBe('N2.2');
    expect(out.soggettoEmittenteTerzo?.denominazione).toBe('Passaggio Veloce S.r.l.');
  });

  it('ordinario (aliquota 22): cedente RF01, nessuna Natura, ma terzo = PV (PV emette per conto)', () => {
    const out = toFatturaPaInput({
      ...base(),
      emittente: BROKER,
      destinatario: PV,
      emittenteIsPv: false,
      imponibileCent: 2049,
      ivaCent: 451,
      aliquotaIvaPct: 22,
    });
    expect(out.cedentePrestatore.regimeFiscale).toBe('RF01');
    expect(out.natura).toBeNull();
    expect(out.soggettoEmittenteTerzo?.partitaIva).toBe('12345678901');
  });
});

describe('toFatturaPaInput — produce un XML valido end-to-end', () => {
  it('il forfettario per conto terzi genera SoggettoEmittente TZ', async () => {
    const { buildFatturaPaXml } = await import('./xml-fatturapa');
    const out = toFatturaPaInput({
      ...base(),
      fatturaPaTipo: 'TD06',
      emittente: BROKER,
      destinatario: PV,
      emittenteIsPv: false,
      imponibileCent: 2000,
      ivaCent: 0,
      aliquotaIvaPct: 0,
    });
    const xml = buildFatturaPaXml(out);
    expect(xml).toContain('<SoggettoEmittente>TZ</SoggettoEmittente>');
    expect(xml).toContain('<RegimeFiscale>RF19</RegimeFiscale>');
  });
});
