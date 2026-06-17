import { describe, it, expect } from 'vitest';
import { buildFatturaPaXml, type FatturaPaInput, type FatturaPaParte } from './xml-fatturapa';

const PV: FatturaPaParte = {
  denominazione: 'Passaggio Veloce S.r.l.',
  partitaIva: '12345678901',
  indirizzo: 'Via Roma 1',
  cap: '20100',
  comune: 'Milano',
  provincia: 'MI',
  regimeFiscale: 'RF01',
};

const AGENZIA: FatturaPaParte = {
  denominazione: 'Agenzia Pratiche Auto S.r.l.',
  partitaIva: '98765432109',
  indirizzo: 'Corso Italia 22',
  cap: '10100',
  comune: 'Torino',
  provincia: 'TO',
  codiceDestinatario: 'ABCDEFG',
};

const BROKER_FORF: FatturaPaParte = {
  denominazione: 'Autosalone Bianchi di Mario Bianchi',
  partitaIva: '11122233344',
  indirizzo: 'Via Verdi 9',
  cap: '50100',
  comune: 'Firenze',
  provincia: 'FI',
  regimeFiscale: 'RF19',
};

/** FATTURA_PV ordinaria: PV → agenzia, €50 lordi (imponibile 40,98 + IVA 9,02). */
function fatturaPvOrdinaria(): FatturaPaInput {
  return {
    tipoDocumento: 'TD01',
    numero: '7/2026',
    data: '2026-06-17',
    cedentePrestatore: PV,
    cessionarioCommittente: AGENZIA,
    imponibileCent: 4098,
    ivaCent: 902,
    aliquotaIvaPct: 22,
    descrizione: 'Servizio di intermediazione per passaggio di proprietà',
    progressivoInvio: '00007',
    idTrasmittente: { idPaese: 'IT', idCodice: '12345678901' },
  };
}

/** DOC_BROKER forfettario emesso da PV per conto del broker → PV, €20 fuori campo. */
function docBrokerForfettario(): FatturaPaInput {
  return {
    tipoDocumento: 'TD06',
    numero: '3/2026',
    data: '2026-06-17',
    cedentePrestatore: BROKER_FORF,
    cessionarioCommittente: PV,
    imponibileCent: 2000,
    ivaCent: 0,
    aliquotaIvaPct: 0,
    natura: 'N2.2',
    descrizione: 'Compenso di intermediazione',
    soggettoEmittenteTerzo: PV,
    progressivoInvio: '00003',
    idTrasmittente: { idPaese: 'IT', idCodice: '12345678901' },
  };
}

/** Estrae il testo del primo elemento <name>…</name>. */
function tag(xml: string, name: string): string | undefined {
  return xml.match(new RegExp(`<${name}>([^<]*)</${name}>`))?.[1];
}

describe('buildFatturaPaXml — struttura base', () => {
  it('è ben formato: dichiarazione XML + radice FatturaElettronica versione FPR12', () => {
    const xml = buildFatturaPaXml(fatturaPvOrdinaria());
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(xml).toContain('versione="FPR12"');
    expect(xml).toContain('</p:FatturaElettronica>');
  });

  it('non contiene mai segnaposto sporchi (undefined/null/NaN)', () => {
    const xml = buildFatturaPaXml(fatturaPvOrdinaria());
    expect(xml).not.toMatch(/undefined|null|NaN/);
  });

  it('è bilanciato: ogni tag aperto viene chiuso nell’ordine corretto (stack)', () => {
    const xml = buildFatturaPaXml(fatturaPvOrdinaria()).replace(/<\?xml[^>]*\?>/, '');
    const stack: string[] = [];
    for (const m of xml.matchAll(/<(\/?)([A-Za-z][\w:.-]*)[^>]*?(\/?)>/g)) {
      const [, slash, name, selfClose] = m;
      if (selfClose) continue;
      if (slash) {
        expect(stack.pop()).toBe(name);
      } else {
        stack.push(name);
      }
    }
    expect(stack).toEqual([]);
  });
});

describe('buildFatturaPaXml — FATTURA_PV ordinaria (TD01)', () => {
  it('imposta tipo, numero, data e totale documento', () => {
    const xml = buildFatturaPaXml(fatturaPvOrdinaria());
    expect(tag(xml, 'TipoDocumento')).toBe('TD01');
    expect(tag(xml, 'Numero')).toBe('7/2026');
    expect(tag(xml, 'Data')).toBe('2026-06-17');
    expect(tag(xml, 'ImportoTotaleDocumento')).toBe('50.00');
    expect(tag(xml, 'FormatoTrasmissione')).toBe('FPR12');
  });

  it('cedente = PV con RegimeFiscale RF01, cessionario = agenzia', () => {
    const xml = buildFatturaPaXml(fatturaPvOrdinaria());
    const cedente = xml.slice(xml.indexOf('<CedentePrestatore>'), xml.indexOf('</CedentePrestatore>'));
    const cessionario = xml.slice(xml.indexOf('<CessionarioCommittente>'), xml.indexOf('</CessionarioCommittente>'));
    expect(cedente).toContain('<Denominazione>Passaggio Veloce S.r.l.</Denominazione>');
    expect(cedente).toContain('<RegimeFiscale>RF01</RegimeFiscale>');
    expect(cessionario).toContain('<Denominazione>Agenzia Pratiche Auto S.r.l.</Denominazione>');
  });

  it('riepilogo IVA 22%: imponibile 40,98 + imposta 9,02, nessuna Natura', () => {
    const xml = buildFatturaPaXml(fatturaPvOrdinaria());
    expect(tag(xml, 'AliquotaIVA')).toBe('22.00');
    expect(tag(xml, 'ImponibileImporto')).toBe('40.98');
    expect(tag(xml, 'Imposta')).toBe('9.02');
    expect(xml).not.toContain('<Natura>');
  });

  it('CodiceDestinatario = SDI agenzia, nessun PECDestinatario', () => {
    const xml = buildFatturaPaXml(fatturaPvOrdinaria());
    expect(tag(xml, 'CodiceDestinatario')).toBe('ABCDEFG');
    expect(xml).not.toContain('<PECDestinatario>');
  });

  it('IdTrasmittente = P.IVA PV, nessun SoggettoEmittente (PV emette in proprio)', () => {
    const xml = buildFatturaPaXml(fatturaPvOrdinaria());
    expect(xml).toContain('<ProgressivoInvio>00007</ProgressivoInvio>');
    expect(xml).not.toContain('<SoggettoEmittente>');
    expect(xml).not.toContain('<TerzoIntermediarioOSoggettoEmittente>');
  });
});

describe('buildFatturaPaXml — DOC_BROKER forfettario per conto terzi (TD06)', () => {
  it('tipo TD06, AliquotaIVA 0, Imposta 0, Natura N2.2', () => {
    const xml = buildFatturaPaXml(docBrokerForfettario());
    expect(tag(xml, 'TipoDocumento')).toBe('TD06');
    expect(tag(xml, 'AliquotaIVA')).toBe('0.00');
    expect(tag(xml, 'Imposta')).toBe('0.00');
    expect(tag(xml, 'ImponibileImporto')).toBe('20.00');
    expect(xml).toContain('<Natura>N2.2</Natura>');
  });

  it('include RiferimentoNormativo con la L. 190/2014 (regime forfettario)', () => {
    const xml = buildFatturaPaXml(docBrokerForfettario());
    expect(xml).toContain('<RiferimentoNormativo>');
    expect(xml).toMatch(/190\/2014/);
  });

  it('cedente = broker RF19, SoggettoEmittente TZ + TerzoIntermediario = PV', () => {
    const xml = buildFatturaPaXml(docBrokerForfettario());
    const cedente = xml.slice(xml.indexOf('<CedentePrestatore>'), xml.indexOf('</CedentePrestatore>'));
    expect(cedente).toContain('<Denominazione>Autosalone Bianchi di Mario Bianchi</Denominazione>');
    expect(cedente).toContain('<RegimeFiscale>RF19</RegimeFiscale>');
    expect(xml).toContain('<SoggettoEmittente>TZ</SoggettoEmittente>');
    const terzo = xml.slice(
      xml.indexOf('<TerzoIntermediarioOSoggettoEmittente>'),
      xml.indexOf('</TerzoIntermediarioOSoggettoEmittente>'),
    );
    expect(terzo).toContain('<Denominazione>Passaggio Veloce S.r.l.</Denominazione>');
  });
});

describe('buildFatturaPaXml — destinatario via PEC', () => {
  it('senza SDI: CodiceDestinatario 0000000 + PECDestinatario', () => {
    const input = fatturaPvOrdinaria();
    input.cessionarioCommittente = {
      ...AGENZIA,
      codiceDestinatario: null,
      pec: 'agenzia@pec.it',
    };
    const xml = buildFatturaPaXml(input);
    expect(tag(xml, 'CodiceDestinatario')).toBe('0000000');
    expect(tag(xml, 'PECDestinatario')).toBe('agenzia@pec.it');
  });
});

describe('buildFatturaPaXml — nota di credito (TD04)', () => {
  it('usa importi positivi anche con input negativo', () => {
    const input: FatturaPaInput = {
      ...fatturaPvOrdinaria(),
      tipoDocumento: 'TD04',
      imponibileCent: -4098,
      ivaCent: -902,
    };
    const xml = buildFatturaPaXml(input);
    expect(tag(xml, 'TipoDocumento')).toBe('TD04');
    expect(tag(xml, 'ImponibileImporto')).toBe('40.98');
    expect(tag(xml, 'Imposta')).toBe('9.02');
    expect(tag(xml, 'ImportoTotaleDocumento')).toBe('50.00');
    // nessun importo negativo (gli importi monetari non iniziano mai con '-')
    expect(xml).not.toMatch(/>-\d/);
  });
});

describe('buildFatturaPaXml — escaping', () => {
  it('effettua l’escape dei caratteri speciali XML nelle denominazioni', () => {
    const input = fatturaPvOrdinaria();
    input.cessionarioCommittente = { ...AGENZIA, denominazione: 'Rossi & Co. <S.r.l.>' };
    const xml = buildFatturaPaXml(input);
    expect(xml).toContain('Rossi &amp; Co. &lt;S.r.l.&gt;');
    expect(xml).not.toContain('Rossi & Co. <S.r.l.>');
  });
});
