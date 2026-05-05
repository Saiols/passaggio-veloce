import { describe, it, expect } from 'vitest';
import {
  calcolaDocumentiRichiesti,
  type SchemaDocumentaleInput,
} from './engine';

const REF_NOW = new Date('2026-05-06T12:00:00Z');

function baseInput(
  overrides: Partial<SchemaDocumentaleInput> = {},
): SchemaDocumentaleInput {
  return {
    preImm2015: false,
    flagComodatoDuso: false,
    venditoreTipoSoggetto: 'PRIVATO_ITALIANO_CIE',
    venditoreVisuraData: null,
    venditorePermessoData: null,
    flagProcura: false,
    flagSuccessione: false,
    acquirenteTipoSoggetto: 'PRIVATO_ITALIANO_CIE',
    acquirenteVisuraData: null,
    acquirentePermessoData: null,
    flagMinore: false,
    now: REF_NOW,
    ...overrides,
  };
}

describe('calcolaDocumentiRichiesti — casi base', () => {
  it('venditore CIE → acquirente CIE, post-2015: libretto + CI F+R venditore + CI F+R acquirente (5 doc)', () => {
    const r = calcolaDocumentiRichiesti(baseInput());
    expect(r.kind).toBe('OK');
    if (r.kind !== 'OK') return;
    expect(r.documentiRichiesti).toHaveLength(5);
    expect(r.documentiRichiesti.map((d) => d.tipo)).toEqual([
      'LIBRETTO_CIRCOLAZIONE',
      'CI_FRONTE',
      'CI_RETRO',
      'CI_FRONTE',
      'CI_RETRO',
    ]);
  });

  it('pre-2015 aggiunge CERTIFICATO_PROPRIETA al veicolo', () => {
    const r = calcolaDocumentiRichiesti(baseInput({ preImm2015: true }));
    expect(r.kind).toBe('OK');
    if (r.kind !== 'OK') return;
    const veicolo = r.documentiRichiesti.filter((d) => d.parte === 'VEICOLO');
    expect(veicolo.map((d) => d.tipo)).toEqual([
      'LIBRETTO_CIRCOLAZIONE',
      'CERTIFICATO_PROPRIETA',
    ]);
  });

  it('CI cartacea aggiunge CODICE_FISCALE (3 doc venditore invece di 2)', () => {
    const r = calcolaDocumentiRichiesti(
      baseInput({ venditoreTipoSoggetto: 'PRIVATO_ITALIANO_CARTACEA' }),
    );
    expect(r.kind).toBe('OK');
    if (r.kind !== 'OK') return;
    const venditore = r.documentiRichiesti.filter(
      (d) => d.parte === 'VENDITORE',
    );
    expect(venditore.map((d) => d.tipo).sort()).toEqual([
      'CI_FRONTE',
      'CI_RETRO',
      'CODICE_FISCALE',
    ]);
  });
});

describe('calcolaDocumentiRichiesti — straniero extra-UE', () => {
  it('venditore straniero con permesso valido richiede CI F+R + permesso', () => {
    const valido = new Date(REF_NOW);
    valido.setMonth(valido.getMonth() + 6);
    const r = calcolaDocumentiRichiesti(
      baseInput({
        venditoreTipoSoggetto: 'STRANIERO_EXTRA_UE',
        venditorePermessoData: valido,
      }),
    );
    expect(r.kind).toBe('OK');
    if (r.kind !== 'OK') return;
    const venditore = r.documentiRichiesti.filter(
      (d) => d.parte === 'VENDITORE',
    );
    expect(venditore.map((d) => d.tipo).sort()).toEqual([
      'CI_FRONTE',
      'CI_RETRO',
      'PERMESSO_SOGGIORNO',
    ]);
  });

  it('venditore straniero con permesso scaduto → BLOCCO', () => {
    const scaduto = new Date(REF_NOW);
    scaduto.setMonth(scaduto.getMonth() - 1);
    const r = calcolaDocumentiRichiesti(
      baseInput({
        venditoreTipoSoggetto: 'STRANIERO_EXTRA_UE',
        venditorePermessoData: scaduto,
      }),
    );
    expect(r.kind).toBe('BLOCCO');
    if (r.kind !== 'BLOCCO') return;
    expect(r.motivo).toContain('venditore');
  });

  it('venditore straniero senza data permesso compilata → BLOCCO', () => {
    const r = calcolaDocumentiRichiesti(
      baseInput({
        venditoreTipoSoggetto: 'STRANIERO_EXTRA_UE',
        venditorePermessoData: null,
      }),
    );
    expect(r.kind).toBe('BLOCCO');
  });

  it('acquirente straniero con permesso scaduto → BLOCCO', () => {
    const scaduto = new Date(REF_NOW);
    scaduto.setMonth(scaduto.getMonth() - 1);
    const r = calcolaDocumentiRichiesti(
      baseInput({
        acquirenteTipoSoggetto: 'STRANIERO_EXTRA_UE',
        acquirentePermessoData: scaduto,
      }),
    );
    expect(r.kind).toBe('BLOCCO');
    if (r.kind !== 'BLOCCO') return;
    expect(r.motivo).toContain('acquirente');
  });
});

describe('calcolaDocumentiRichiesti — azienda / operatore auto', () => {
  it('venditore azienda con visura recente: visura + CI amministratore F+R', () => {
    const fresca = new Date(REF_NOW);
    fresca.setMonth(fresca.getMonth() - 2);
    const r = calcolaDocumentiRichiesti(
      baseInput({
        venditoreTipoSoggetto: 'AZIENDA',
        venditoreVisuraData: fresca,
      }),
    );
    expect(r.kind).toBe('OK');
    if (r.kind !== 'OK') return;
    const venditori = r.documentiRichiesti.filter(
      (d) =>
        d.parte === 'VENDITORE' || d.parte === 'AMMINISTRATORE_VENDITORE',
    );
    expect(venditori.map((d) => d.tipo).sort()).toEqual([
      'CI_FRONTE',
      'CI_RETRO',
      'VISURA_CAMERALE',
    ]);
  });

  it('venditore azienda con visura > 6 mesi → BLOCCO', () => {
    const vecchia = new Date(REF_NOW);
    vecchia.setMonth(vecchia.getMonth() - 8);
    const r = calcolaDocumentiRichiesti(
      baseInput({
        venditoreTipoSoggetto: 'AZIENDA',
        venditoreVisuraData: vecchia,
      }),
    );
    expect(r.kind).toBe('BLOCCO');
    if (r.kind !== 'BLOCCO') return;
    expect(r.motivo.toLowerCase()).toContain('visura');
  });

  it('venditore operatore auto richiede stessi documenti azienda (mini voltura)', () => {
    const fresca = new Date(REF_NOW);
    fresca.setMonth(fresca.getMonth() - 1);
    const r = calcolaDocumentiRichiesti(
      baseInput({
        venditoreTipoSoggetto: 'OPERATORE_AUTO',
        venditoreVisuraData: fresca,
      }),
    );
    expect(r.kind).toBe('OK');
    if (r.kind !== 'OK') return;
    const tipi = r.documentiRichiesti.map((d) => d.tipo);
    expect(tipi).toContain('VISURA_CAMERALE');
  });

  it('acquirente azienda senza visura → BLOCCO', () => {
    const r = calcolaDocumentiRichiesti(
      baseInput({
        acquirenteTipoSoggetto: 'AZIENDA',
        acquirenteVisuraData: null,
      }),
    );
    expect(r.kind).toBe('BLOCCO');
  });
});

describe('calcolaDocumentiRichiesti — flag speciali', () => {
  it('flagProcura aggiunge atto procura + CI F+R procuratore', () => {
    const r = calcolaDocumentiRichiesti(baseInput({ flagProcura: true }));
    expect(r.kind).toBe('OK');
    if (r.kind !== 'OK') return;
    const procuratore = r.documentiRichiesti.filter(
      (d) => d.parte === 'PROCURATORE',
    );
    expect(procuratore.map((d) => d.tipo).sort()).toEqual([
      'CI_FRONTE',
      'CI_RETRO',
      'PROCURA',
    ]);
  });

  it('flagSuccessione aggiunge cert.morte + atto eredità + dichiarazione', () => {
    const r = calcolaDocumentiRichiesti(baseInput({ flagSuccessione: true }));
    expect(r.kind).toBe('OK');
    if (r.kind !== 'OK') return;
    const erede = r.documentiRichiesti.filter((d) => d.parte === 'EREDE');
    expect(erede.map((d) => d.tipo).sort()).toEqual([
      'ATTO_ACCETTAZIONE_EREDITA',
      'CERTIFICATO_MORTE',
      'DICHIARAZIONE_QUALITA_EREDE',
    ]);
  });

  it('flagMinore aggiunge autorizzazione tutore + CI F+R tutore', () => {
    const r = calcolaDocumentiRichiesti(baseInput({ flagMinore: true }));
    expect(r.kind).toBe('OK');
    if (r.kind !== 'OK') return;
    const tutore = r.documentiRichiesti.filter((d) => d.parte === 'TUTORE');
    expect(tutore.map((d) => d.tipo).sort()).toEqual([
      'AUTORIZZAZIONE_TUTORE',
      'CI_FRONTE',
      'CI_RETRO',
    ]);
  });
});

describe('calcolaDocumentiRichiesti — comodato / blocchi', () => {
  it('comodato attivo → BLOCCO', () => {
    const r = calcolaDocumentiRichiesti(
      baseInput({ flagComodatoDuso: true }),
    );
    expect(r.kind).toBe('BLOCCO');
    if (r.kind !== 'BLOCCO') return;
    expect(r.motivo.toLowerCase()).toContain('comodato');
    expect(r.soluzione.toLowerCase()).toContain('revocato');
  });

  it('input incompleto: tipo soggetto venditore mancante', () => {
    const r = calcolaDocumentiRichiesti(
      baseInput({ venditoreTipoSoggetto: null }),
    );
    expect(r.kind).toBe('INPUT_INCOMPLETO');
    if (r.kind !== 'INPUT_INCOMPLETO') return;
    expect(r.mancanti).toContain('venditoreTipoSoggetto');
  });

  it('input incompleto: tipo soggetto acquirente mancante', () => {
    const r = calcolaDocumentiRichiesti(
      baseInput({ acquirenteTipoSoggetto: null }),
    );
    expect(r.kind).toBe('INPUT_INCOMPLETO');
    if (r.kind !== 'INPUT_INCOMPLETO') return;
    expect(r.mancanti).toContain('acquirenteTipoSoggetto');
  });
});

describe('calcolaDocumentiRichiesti — combinazioni complesse', () => {
  it('caso massimo: pre-2015 + procura + successione + minore → 14+ doc', () => {
    const fresca = new Date(REF_NOW);
    fresca.setMonth(fresca.getMonth() - 1);
    const r = calcolaDocumentiRichiesti(
      baseInput({
        preImm2015: true,
        venditoreTipoSoggetto: 'PRIVATO_ITALIANO_CARTACEA',
        flagProcura: true,
        flagSuccessione: true,
        acquirenteTipoSoggetto: 'AZIENDA',
        acquirenteVisuraData: fresca,
        flagMinore: true,
      }),
    );
    expect(r.kind).toBe('OK');
    if (r.kind !== 'OK') return;
    expect(r.documentiRichiesti.length).toBeGreaterThanOrEqual(14);
    // Verifico presenza categoriale
    const tipi = new Set(r.documentiRichiesti.map((d) => d.tipo));
    expect(tipi.has('CERTIFICATO_PROPRIETA')).toBe(true);
    expect(tipi.has('PROCURA')).toBe(true);
    expect(tipi.has('CERTIFICATO_MORTE')).toBe(true);
    expect(tipi.has('AUTORIZZAZIONE_TUTORE')).toBe(true);
    expect(tipi.has('VISURA_CAMERALE')).toBe(true);
  });

  it('venditore italiano CIE + acquirente azienda fresca: minimo + visura', () => {
    const fresca = new Date(REF_NOW);
    fresca.setMonth(fresca.getMonth() - 3);
    const r = calcolaDocumentiRichiesti(
      baseInput({
        acquirenteTipoSoggetto: 'AZIENDA',
        acquirenteVisuraData: fresca,
      }),
    );
    expect(r.kind).toBe('OK');
    if (r.kind !== 'OK') return;
    const tipiAcquirenteSet = new Set(
      r.documentiRichiesti
        .filter(
          (d) =>
            d.parte === 'ACQUIRENTE' ||
            d.parte === 'AMMINISTRATORE_ACQUIRENTE',
        )
        .map((d) => d.tipo),
    );
    expect(tipiAcquirenteSet.has('VISURA_CAMERALE')).toBe(true);
    expect(tipiAcquirenteSet.has('CI_FRONTE')).toBe(true);
    expect(tipiAcquirenteSet.has('CI_RETRO')).toBe(true);
  });
});

describe('calcolaDocumentiRichiesti — soglia visura 6 mesi', () => {
  it('visura esattamente al limite (6 mesi e 1 giorno fa) → BLOCCO', () => {
    const al_limite = new Date(REF_NOW);
    al_limite.setMonth(al_limite.getMonth() - 6);
    al_limite.setDate(al_limite.getDate() - 1);
    const r = calcolaDocumentiRichiesti(
      baseInput({
        venditoreTipoSoggetto: 'AZIENDA',
        venditoreVisuraData: al_limite,
      }),
    );
    expect(r.kind).toBe('BLOCCO');
  });

  it('visura emessa oggi → OK', () => {
    const r = calcolaDocumentiRichiesti(
      baseInput({
        venditoreTipoSoggetto: 'AZIENDA',
        venditoreVisuraData: REF_NOW,
      }),
    );
    expect(r.kind).toBe('OK');
  });
});
