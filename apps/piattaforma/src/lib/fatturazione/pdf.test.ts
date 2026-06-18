import { describe, it, expect } from 'vitest';
import { buildDocumentoPdf, type DocumentoPdfInput } from './pdf';
import type { DatiFiscali } from './pv-emittente';

const PV: DatiFiscali = {
  ragioneSociale: 'Passaggio Veloce S.r.l.',
  partitaIva: '14688390963',
  codiceSdi: null,
  pec: 'pv@pec.it',
  indirizzo: 'Via Roma 1',
  cap: '20100',
  citta: 'Milano',
  provincia: 'MI',
};

function baseInput(over: Partial<DocumentoPdfInput> = {}): DocumentoPdfInput {
  return {
    tipo: 'FATTURA_PV',
    fatturaPaTipo: 'TD01',
    numeroProgressivo: 7,
    anno: 2026,
    emessoAt: new Date('2026-06-17T10:00:00Z'),
    emittente: PV,
    destinatario: {
      ragioneSociale: 'Agenzia Pratiche Auto S.r.l.',
      partitaIva: '98765432109',
      codiceSdi: 'ABCDEFG',
      pec: null,
      indirizzo: 'Corso Italia 22',
      cap: '10100',
      citta: 'Torino',
      provincia: 'TO',
    },
    imponibileCent: 4098,
    ivaCent: 902,
    aliquotaIvaPct: 22,
    importoLordoCent: 5000,
    descrizione: 'Servizio di intermediazione per passaggio di proprietà',
    riferimento: 'Pratica PV-2026-00042',
    ...over,
  };
}

describe('buildDocumentoPdf — robustezza encoding', () => {
  it('genera il PDF con dati ASCII/Latin-1 standard', async () => {
    const bytes = await buildDocumentoPdf(baseInput());
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.length).toBeGreaterThan(500);
    // header PDF
    expect(Buffer.from(bytes.slice(0, 5)).toString('latin1')).toBe('%PDF-');
  });

  // Regressione del 500 in prod: GET /api/fatturazione/<id>/pdf →
  // "Error: WinAnsi cannot encode …". I dati anagrafici reali (ragione sociale,
  // indirizzo) possono contenere caratteri fuori CP1252 che pdf-lib non sa
  // codificare con lo StandardFont. Il PDF NON deve mai crashare per questo.
  it('NON crasha con caratteri fuori CP1252 nei dati anagrafici', async () => {
    const input = baseInput({
      destinatario: {
        ragioneSociale: 'Авто Сервис “Москва” Çağrı Ω',
        partitaIva: '98765432109',
        codiceSdi: 'ABCDEFG',
        pec: null,
        indirizzo: 'Straße 12 – 中央区',
        cap: '10100',
        citta: 'İstanbul',
        provincia: 'TO',
      },
    });
    const bytes = await buildDocumentoPdf(input);
    expect(bytes.length).toBeGreaterThan(500);
  });

  it('NON crasha con lo spazio stretto U+202F (es. valuta da ICU)', async () => {
    const input = baseInput({ descrizione: 'Totale 1.234,56 € compenso' });
    const bytes = await buildDocumentoPdf(input);
    expect(bytes.length).toBeGreaterThan(500);
  });
});
