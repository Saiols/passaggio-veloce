import { describe, it, expect } from 'vitest';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { buildDocumentoPdf, wrapText, type DocumentoPdfInput } from './pdf';
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
    numeroDocumentoStr: 'PV-2026-00007',
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

  it('genera il PDF con la sede di riferimento (lato destinatario) senza crashare', async () => {
    const input = baseInput({
      sede: { nome: 'AutoScout Milano', citta: 'Milano', provincia: 'MI', lato: 'destinatario' },
    });
    const bytes = await buildDocumentoPdf(input);
    expect(bytes.length).toBeGreaterThan(500);
  });

  it('genera il PDF con descrizione e riferimento molto lunghi (wrap, no overflow)', async () => {
    const input = baseInput({
      descrizione:
        'Servizio di intermediazione per passaggio di proprieta di autoveicolo usato con pratica completa',
      riferimento:
        'Payout del 17/06/2026 - pratiche: PV-2026-00042, PV-2026-00043, PV-2026-00044, PV-2026-00045',
    });
    const bytes = await buildDocumentoPdf(input);
    expect(bytes.length).toBeGreaterThan(500);
  });
});

describe('buildDocumentoPdf — data di emissione in calendario italiano', () => {
  // Regressione: `emessoAt` resta l'istante UTC del `now()` del DB (emissione
  // guidata da cron/webhook, non più da un umano che firma). Il PDF deve
  // stampare la data del calendario di Roma, non quella del fuso del runtime.
  //
  // TZ forzato a UTC — il fuso del runtime Vercel in produzione — e NON
  // lasciato a quello della macchina: su un portatile italiano una
  // formattazione SENZA fuso esplicito produce già "1 gen 2027" per puro
  // caso (il fuso del sistema operativo coincide con Roma), e il test
  // resterebbe verde anche senza la correzione. La premessa sotto lo
  // dimostra: se l'override TZ non avesse effetto, il test cadrebbe rosso lì
  // invece che verde a vuoto.
  it('capodanno: 23:30 UTC del 31/12 si stampa "1 gen 2027", non la data UTC', async () => {
    const tzOriginale = process.env.TZ;
    process.env.TZ = 'UTC';
    try {
      expect(
        new Intl.DateTimeFormat('it-IT', { dateStyle: 'medium' }).format(
          new Date('2026-12-31T23:30:00Z'),
        ),
      ).toBe('31 dic 2026'); // premessa: con TZ=UTC, una formattazione senza fuso esplicito segue l'UTC

      const bytes = await buildDocumentoPdf(baseInput({ emessoAt: new Date('2026-12-31T23:30:00Z') }));
      const { getDocumentProxy, extractText } = await import('unpdf');
      const doc = await getDocumentProxy(new Uint8Array(bytes));
      const res = await extractText(doc, { mergePages: true });
      const text = Array.isArray(res.text) ? res.text.join('\n') : res.text;

      expect(text).toContain('Emesso il 1 gen 2027');
      expect(text).not.toContain('31 dic 2026');
    } finally {
      if (tzOriginale === undefined) delete process.env.TZ;
      else process.env.TZ = tzOriginale;
    }
  });
});

describe('wrapText', () => {
  it('spezza il testo lungo in piu righe entro la larghezza massima', async () => {
    const pdf = await PDFDocument.create();
    const helv = await pdf.embedFont(StandardFonts.Helvetica);
    const maxWidth = 170;
    const testo = 'Servizio di intermediazione per passaggio di proprieta';
    const lines = wrapText(testo, helv, 10, maxWidth);

    expect(lines.length).toBeGreaterThan(1);
    for (const l of lines) {
      expect(helv.widthOfTextAtSize(l, 10)).toBeLessThanOrEqual(maxWidth);
    }
    expect(lines.join(' ')).toBe(testo); // nessuna parola persa o duplicata
  });

  it('tiene su una sola riga un testo corto', async () => {
    const pdf = await PDFDocument.create();
    const helv = await pdf.embedFont(StandardFonts.Helvetica);
    expect(wrapText('Penale', helv, 10, 200)).toEqual(['Penale']);
  });

  it('non restituisce mai un array vuoto', async () => {
    const pdf = await PDFDocument.create();
    const helv = await pdf.embedFont(StandardFonts.Helvetica);
    expect(wrapText('', helv, 10, 200)).toEqual(['']);
  });
});
