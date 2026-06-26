import { describe, it, expect } from 'vitest';
import {
  calcolaDocumentiRichiesti,
  type SchemaDocumentaleInput,
} from './engine';

// Nota: la validità temporale di visura/permesso e la corrispondenza dei
// documenti col soggetto NON sono più nell'engine (spostate in lib/kyc/parte-docs,
// verificate via OCR nello step parte). Qui l'engine emette solo la LISTA dei
// documenti richiesti + i blocchi non-documentali (comodato).

function baseInput(
  overrides: Partial<SchemaDocumentaleInput> = {},
): SchemaDocumentaleInput {
  return {
    veicoli: [{ ordine: 1, preImm2015: false, flagComodatoDuso: false }],
    venditori: [
      { ordine: 1, tipoSoggetto: 'PRIVATO_ITALIANO_CIE', documentoIdentita: 'CI' },
    ],
    flagProcura: false,
    flagSuccessione: false,
    acquirenteTipoSoggetto: 'PRIVATO_ITALIANO_CIE',
    acquirenteDocumentoIdentita: 'CI',
    flagMinore: false,
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
    const r = calcolaDocumentiRichiesti(
      baseInput({ veicoli: [{ ordine: 1, preImm2015: true, flagComodatoDuso: false }] }),
    );
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
      baseInput({ venditori: [{ ordine: 1, tipoSoggetto: 'PRIVATO_ITALIANO_CARTACEA', documentoIdentita: 'CI' }] }),
    );
    expect(r.kind).toBe('OK');
    if (r.kind !== 'OK') return;
    const venditore = r.documentiRichiesti.filter((d) => d.parte === 'VENDITORE');
    expect(venditore.map((d) => d.tipo).sort()).toEqual([
      'CI_FRONTE',
      'CI_RETRO',
      'CODICE_FISCALE',
    ]);
  });
});

describe('calcolaDocumentiRichiesti — straniero / azienda (emissione documenti)', () => {
  it('venditore straniero richiede CI F+R + permesso + CF (validità verificata altrove)', () => {
    const r = calcolaDocumentiRichiesti(
      baseInput({
        venditori: [{ ordine: 1, tipoSoggetto: 'STRANIERO_EXTRA_UE', documentoIdentita: 'CI' }],
      }),
    );
    expect(r.kind).toBe('OK');
    if (r.kind !== 'OK') return;
    const venditore = r.documentiRichiesti.filter((d) => d.parte === 'VENDITORE');
    expect(venditore.map((d) => d.tipo).sort()).toEqual([
      'CI_FRONTE',
      'CI_RETRO',
      'CODICE_FISCALE',
      'PERMESSO_SOGGIORNO',
    ]);
  });

  it('venditore azienda: visura + CI amministratore F+R (freschezza verificata altrove)', () => {
    const r = calcolaDocumentiRichiesti(
      baseInput({
        venditori: [{ ordine: 1, tipoSoggetto: 'AZIENDA', documentoIdentita: 'CI' }],
      }),
    );
    expect(r.kind).toBe('OK');
    if (r.kind !== 'OK') return;
    const venditori = r.documentiRichiesti.filter(
      (d) => d.parte === 'VENDITORE' || d.parte === 'AMMINISTRATORE_VENDITORE',
    );
    expect(venditori.map((d) => d.tipo).sort()).toEqual([
      'CI_FRONTE',
      'CI_RETRO',
      'VISURA_CAMERALE',
    ]);
  });

  it('venditore operatore auto richiede stessi documenti azienda (mini voltura)', () => {
    const r = calcolaDocumentiRichiesti(
      baseInput({
        venditori: [{ ordine: 1, tipoSoggetto: 'OPERATORE_AUTO', documentoIdentita: 'CI' }],
      }),
    );
    expect(r.kind).toBe('OK');
    if (r.kind !== 'OK') return;
    expect(r.documentiRichiesti.map((d) => d.tipo)).toContain('VISURA_CAMERALE');
  });
});

describe('calcolaDocumentiRichiesti — flag speciali', () => {
  it('flagProcura aggiunge atto procura + CI F+R procuratore', () => {
    const r = calcolaDocumentiRichiesti(baseInput({ flagProcura: true }));
    expect(r.kind).toBe('OK');
    if (r.kind !== 'OK') return;
    const procuratore = r.documentiRichiesti.filter((d) => d.parte === 'PROCURATORE');
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

describe('calcolaDocumentiRichiesti — comodato non ostativo / input incompleto', () => {
  it('comodato attivo NON blocca più la pratica → OK', () => {
    const r = calcolaDocumentiRichiesti(
      baseInput({ veicoli: [{ ordine: 1, preImm2015: false, flagComodatoDuso: true }] }),
    );
    expect(r.kind).toBe('OK');
  });

  it('comodato attivo su un veicolo qualsiasi (multi) → OK', () => {
    const r = calcolaDocumentiRichiesti(
      baseInput({
        veicoli: [
          { ordine: 1, preImm2015: false, flagComodatoDuso: false },
          { ordine: 2, preImm2015: false, flagComodatoDuso: true },
        ],
      }),
    );
    expect(r.kind).toBe('OK');
  });

  it('input incompleto: tipo soggetto venditore mancante', () => {
    const r = calcolaDocumentiRichiesti(
      baseInput({ venditori: [{ ordine: 1, tipoSoggetto: null, documentoIdentita: 'CI' }] }),
    );
    expect(r.kind).toBe('INPUT_INCOMPLETO');
    if (r.kind !== 'INPUT_INCOMPLETO') return;
    expect(r.mancanti).toContain('venditoreTipoSoggetto');
  });

  it('input incompleto: tipo soggetto acquirente mancante', () => {
    const r = calcolaDocumentiRichiesti(baseInput({ acquirenteTipoSoggetto: null }));
    expect(r.kind).toBe('INPUT_INCOMPLETO');
    if (r.kind !== 'INPUT_INCOMPLETO') return;
    expect(r.mancanti).toContain('acquirenteTipoSoggetto');
  });
});

describe('calcolaDocumentiRichiesti — combinazioni complesse', () => {
  it('caso massimo: pre-2015 + procura + successione + minore + acquirente azienda → 14+ doc', () => {
    const r = calcolaDocumentiRichiesti(
      baseInput({
        veicoli: [{ ordine: 1, preImm2015: true, flagComodatoDuso: false }],
        venditori: [{ ordine: 1, tipoSoggetto: 'PRIVATO_ITALIANO_CARTACEA', documentoIdentita: 'CI' }],
        flagProcura: true,
        flagSuccessione: true,
        acquirenteTipoSoggetto: 'AZIENDA',
        flagMinore: true,
      }),
    );
    expect(r.kind).toBe('OK');
    if (r.kind !== 'OK') return;
    expect(r.documentiRichiesti.length).toBeGreaterThanOrEqual(14);
    const tipi = new Set(r.documentiRichiesti.map((d) => d.tipo));
    expect(tipi.has('CERTIFICATO_PROPRIETA')).toBe(true);
    expect(tipi.has('PROCURA')).toBe(true);
    expect(tipi.has('CERTIFICATO_MORTE')).toBe(true);
    expect(tipi.has('AUTORIZZAZIONE_TUTORE')).toBe(true);
    expect(tipi.has('VISURA_CAMERALE')).toBe(true);
  });

  it('acquirente azienda: documenti acquirente includono visura + CI', () => {
    const r = calcolaDocumentiRichiesti(baseInput({ acquirenteTipoSoggetto: 'AZIENDA' }));
    expect(r.kind).toBe('OK');
    if (r.kind !== 'OK') return;
    const tipiAcq = new Set(
      r.documentiRichiesti
        .filter((d) => d.parte === 'ACQUIRENTE' || d.parte === 'AMMINISTRATORE_ACQUIRENTE')
        .map((d) => d.tipo),
    );
    expect(tipiAcq.has('VISURA_CAMERALE')).toBe(true);
    expect(tipiAcq.has('CI_FRONTE')).toBe(true);
    expect(tipiAcq.has('CI_RETRO')).toBe(true);
  });
});

describe('calcolaDocumentiRichiesti — multi-veicolo', () => {
  it('due veicoli: libretto per ciascuno + CdP solo sul pre-2015', () => {
    const r = calcolaDocumentiRichiesti(
      baseInput({
        veicoli: [
          { ordine: 1, preImm2015: false, flagComodatoDuso: false },
          { ordine: 2, preImm2015: true, flagComodatoDuso: false },
        ],
      }),
    );
    expect(r.kind).toBe('OK');
    if (r.kind !== 'OK') return;
    const libretti = r.documentiRichiesti.filter((d) => d.tipo === 'LIBRETTO_CIRCOLAZIONE');
    expect(libretti.map((d) => d.veicoloOrdine)).toEqual([1, 2]);
    const cdp = r.documentiRichiesti.filter((d) => d.tipo === 'CERTIFICATO_PROPRIETA');
    expect(cdp).toHaveLength(1);
    expect(cdp[0]!.veicoloOrdine).toBe(2);
  });
});

describe('calcolaDocumentiRichiesti — co-intestatari venditori', () => {
  it('due venditori: documenti identità per ciascuno con venditoreOrdine', () => {
    const r = calcolaDocumentiRichiesti(
      baseInput({
        venditori: [
          { ordine: 1, tipoSoggetto: 'PRIVATO_ITALIANO_CIE', documentoIdentita: 'CI' },
          { ordine: 2, tipoSoggetto: 'PRIVATO_ITALIANO_CIE', documentoIdentita: 'CI' },
        ],
      }),
    );
    expect(r.kind).toBe('OK');
    if (r.kind !== 'OK') return;
    const vendCI = r.documentiRichiesti.filter((d) => d.parte === 'VENDITORE' && d.tipo === 'CI_FRONTE');
    expect(vendCI.map((d) => d.venditoreOrdine).sort()).toEqual([1, 2]);
  });
});

describe('calcolaDocumentiRichiesti — documento identità alternativo', () => {
  it('venditore con passaporto: richiede PASSAPORTO non CI', () => {
    const r = calcolaDocumentiRichiesti(
      baseInput({ venditori: [{ ordine: 1, tipoSoggetto: 'PRIVATO_ITALIANO_CIE', documentoIdentita: 'PASSAPORTO' }] }),
    );
    expect(r.kind).toBe('OK');
    if (r.kind !== 'OK') return;
    const tipiVend = r.documentiRichiesti.filter((d) => d.parte === 'VENDITORE').map((d) => d.tipo);
    expect(tipiVend).toContain('PASSAPORTO');
    expect(tipiVend).not.toContain('CI_FRONTE');
  });

  it('venditore con patente: richiede PATENTE non CI', () => {
    const r = calcolaDocumentiRichiesti(
      baseInput({ venditori: [{ ordine: 1, tipoSoggetto: 'PRIVATO_ITALIANO_CIE', documentoIdentita: 'PATENTE' }] }),
    );
    expect(r.kind).toBe('OK');
    if (r.kind !== 'OK') return;
    const tipiVend = r.documentiRichiesti.filter((d) => d.parte === 'VENDITORE').map((d) => d.tipo);
    expect(tipiVend).toContain('PATENTE');
    expect(tipiVend).not.toContain('CI_FRONTE');
  });

  it('patente: aggiunge PATENTE + PATENTE_RETRO', () => {
    const r = calcolaDocumentiRichiesti(
      baseInput({ venditori: [{ ordine: 1, tipoSoggetto: 'PRIVATO_ITALIANO_CIE', documentoIdentita: 'PATENTE' }] }),
    );
    expect(r.kind).toBe('OK');
    if (r.kind !== 'OK') return;
    const tipiVend = r.documentiRichiesti.filter((d) => d.parte === 'VENDITORE').map((d) => d.tipo);
    expect(tipiVend).toContain('PATENTE');
    expect(tipiVend).toContain('PATENTE_RETRO');
  });

  it('acquirente con passaporto: richiede PASSAPORTO non CI', () => {
    const r = calcolaDocumentiRichiesti(baseInput({ acquirenteDocumentoIdentita: 'PASSAPORTO' }));
    expect(r.kind).toBe('OK');
    if (r.kind !== 'OK') return;
    const tipiAcq = r.documentiRichiesti.filter((d) => d.parte === 'ACQUIRENTE').map((d) => d.tipo);
    expect(tipiAcq).toContain('PASSAPORTO');
    expect(tipiAcq).not.toContain('CI_FRONTE');
  });

  it('venditore azienda con admin passaporto: visura + PASSAPORTO amministratore', () => {
    const r = calcolaDocumentiRichiesti(
      baseInput({
        venditori: [{ ordine: 1, tipoSoggetto: 'AZIENDA', documentoIdentita: 'PASSAPORTO' }],
      }),
    );
    expect(r.kind).toBe('OK');
    if (r.kind !== 'OK') return;
    const tipiAmm = r.documentiRichiesti
      .filter((d) => d.parte === 'AMMINISTRATORE_VENDITORE')
      .map((d) => d.tipo);
    expect(tipiAmm).toContain('PASSAPORTO');
    expect(tipiAmm).not.toContain('CI_FRONTE');
  });

  it('venditore straniero con passaporto: PASSAPORTO + permesso (niente CI)', () => {
    const r = calcolaDocumentiRichiesti(
      baseInput({
        venditori: [{ ordine: 1, tipoSoggetto: 'STRANIERO_EXTRA_UE', documentoIdentita: 'PASSAPORTO' }],
      }),
    );
    expect(r.kind).toBe('OK');
    if (r.kind !== 'OK') return;
    const tipiVend = r.documentiRichiesti.filter((d) => d.parte === 'VENDITORE').map((d) => d.tipo);
    expect(tipiVend).toContain('PASSAPORTO');
    expect(tipiVend).toContain('PERMESSO_SOGGIORNO');
    expect(tipiVend).not.toContain('CI_FRONTE');
  });

  it('CI cartacea con passaporto scelto: aggiunge comunque CODICE_FISCALE', () => {
    const r = calcolaDocumentiRichiesti(
      baseInput({
        venditori: [{ ordine: 1, tipoSoggetto: 'PRIVATO_ITALIANO_CARTACEA', documentoIdentita: 'PASSAPORTO' }],
      }),
    );
    expect(r.kind).toBe('OK');
    if (r.kind !== 'OK') return;
    const tipiVend = r.documentiRichiesti.filter((d) => d.parte === 'VENDITORE').map((d) => d.tipo);
    expect(tipiVend).toContain('PASSAPORTO');
    expect(tipiVend).toContain('CODICE_FISCALE');
  });

  it('venditore passaporto (CIE): PASSAPORTO + CODICE_FISCALE', () => {
    const r = calcolaDocumentiRichiesti(
      baseInput({ venditori: [{ ordine: 1, tipoSoggetto: 'PRIVATO_ITALIANO_CIE', documentoIdentita: 'PASSAPORTO' }] }),
    );
    expect(r.kind).toBe('OK');
    if (r.kind !== 'OK') return;
    const tipiVend = r.documentiRichiesti.filter((d) => d.parte === 'VENDITORE').map((d) => d.tipo);
    expect(tipiVend).toContain('PASSAPORTO');
    expect(tipiVend).toContain('CODICE_FISCALE');
  });

  it('venditore patente: PATENTE + CODICE_FISCALE', () => {
    const r = calcolaDocumentiRichiesti(
      baseInput({ venditori: [{ ordine: 1, tipoSoggetto: 'PRIVATO_ITALIANO_CIE', documentoIdentita: 'PATENTE' }] }),
    );
    expect(r.kind).toBe('OK');
    if (r.kind !== 'OK') return;
    const tipiVend = r.documentiRichiesti.filter((d) => d.parte === 'VENDITORE').map((d) => d.tipo);
    expect(tipiVend).toContain('PATENTE');
    expect(tipiVend).toContain('CODICE_FISCALE');
  });

  it('acquirente patente: PATENTE + CODICE_FISCALE', () => {
    const r = calcolaDocumentiRichiesti(baseInput({ acquirenteDocumentoIdentita: 'PATENTE' }));
    expect(r.kind).toBe('OK');
    if (r.kind !== 'OK') return;
    const tipiAcq = r.documentiRichiesti.filter((d) => d.parte === 'ACQUIRENTE').map((d) => d.tipo);
    expect(tipiAcq).toContain('PATENTE');
    expect(tipiAcq).toContain('CODICE_FISCALE');
  });

  it('CIE + CI: nessun CODICE_FISCALE (venditore e acquirente)', () => {
    const r = calcolaDocumentiRichiesti(baseInput());
    expect(r.kind).toBe('OK');
    if (r.kind !== 'OK') return;
    expect(r.documentiRichiesti.map((d) => d.tipo)).not.toContain('CODICE_FISCALE');
  });

  it('straniero extra-UE + CI: CODICE_FISCALE richiesto', () => {
    const r = calcolaDocumentiRichiesti(
      baseInput({ venditori: [{ ordine: 1, tipoSoggetto: 'STRANIERO_EXTRA_UE', documentoIdentita: 'CI' }] }),
    );
    expect(r.kind).toBe('OK');
    if (r.kind !== 'OK') return;
    const tipiVend = r.documentiRichiesti.filter((d) => d.parte === 'VENDITORE').map((d) => d.tipo);
    expect(tipiVend).toContain('CODICE_FISCALE');
  });

  it('rep azienda con CI: nessun CODICE_FISCALE (CI del rappresentante trattata come CIE)', () => {
    const r = calcolaDocumentiRichiesti(
      baseInput({ venditori: [{ ordine: 1, tipoSoggetto: 'AZIENDA', documentoIdentita: 'CI' }] }),
    );
    expect(r.kind).toBe('OK');
    if (r.kind !== 'OK') return;
    const tipiAmm = r.documentiRichiesti
      .filter((d) => d.parte === 'AMMINISTRATORE_VENDITORE')
      .map((d) => d.tipo);
    expect(tipiAmm).not.toContain('CODICE_FISCALE');
  });

  it('rep operatore auto con passaporto: CODICE_FISCALE richiesto', () => {
    const r = calcolaDocumentiRichiesti(
      baseInput({ venditori: [{ ordine: 1, tipoSoggetto: 'OPERATORE_AUTO', documentoIdentita: 'PASSAPORTO' }] }),
    );
    expect(r.kind).toBe('OK');
    if (r.kind !== 'OK') return;
    const tipiAmm = r.documentiRichiesti
      .filter((d) => d.parte === 'AMMINISTRATORE_VENDITORE')
      .map((d) => d.tipo);
    expect(tipiAmm).toContain('CODICE_FISCALE');
  });
});
