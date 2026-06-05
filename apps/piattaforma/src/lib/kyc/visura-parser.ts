import 'server-only';
import type { OcrExtractInput } from '@/lib/providers/ocr';

export type VisuraData = {
  dataEmissione?: string; // ISO yyyy-mm-dd
  ateco?: string;
  denominazione?: string;
  partitaIva?: string;
  amministratore?: { nome?: string; cognome?: string; codiceFiscale?: string };
  rawText: string;
};

const CF_RE = /\b([A-Z]{6}\d{2}[A-Z]\d{2}[A-Z]\d{3}[A-Z])\b/;
const PIVA_RE = /\b(\d{11})\b/;
const ATECO_RE = /\b(\d{2}\.\d{1,2}(?:\.\d{1,2})?)\b/;
const DATE_RE = /\b(\d{2})\/(\d{2})\/(\d{4})\b/;

/** Parsing best-effort del testo di una visura camerale. Puro/testabile. */
export function parseVisuraText(text: string): VisuraData {
  const out: VisuraData = { rawText: text };
  const upper = text.toUpperCase();

  const denom = /DENOMINAZIONE[:\s]+([^\n]+)/i.exec(text);
  if (denom) out.denominazione = denom[1]!.trim();

  const piva = PIVA_RE.exec(upper);
  if (piva) out.partitaIva = piva[1];

  const ateco = ATECO_RE.exec(upper.includes('ATECO') ? upper.slice(upper.indexOf('ATECO')) : upper);
  if (ateco) out.ateco = ateco[1];

  const date = DATE_RE.exec(upper.includes('ESTRATT') ? upper.slice(upper.indexOf('ESTRATT')) : upper);
  if (date) out.dataEmissione = `${date[3]}-${date[2]}-${date[1]}`;

  const cf = CF_RE.exec(upper);
  // riga amministratore: "COGNOME NOME - C.F. XXX" vicino al CF
  const adminLine = /([A-ZÀ-Ù'']+)\s+([A-ZÀ-Ù'']+)\s*[-–]\s*C\.?F\.?\s*([A-Z0-9]{16})/i.exec(text);
  if (adminLine) {
    out.amministratore = {
      cognome: adminLine[1]!.toUpperCase(),
      nome: adminLine[2]!.toUpperCase(),
      codiceFiscale: adminLine[3]!.toUpperCase(),
    };
  } else if (cf) {
    out.amministratore = { codiceFiscale: cf[1] };
  }
  return out;
}

/** Estrae i dati visura da un PDF. Usa unpdf (testo); se il PDF non ha testo
 * (visura scansionata) fa fallback a Document AI. */
export async function extractVisura(input: OcrExtractInput): Promise<VisuraData> {
  const { getDocumentProxy, extractText: pdfExtractText } = await import('unpdf');
  let text = '';
  try {
    const pdf = await getDocumentProxy(new Uint8Array(input.buffer));
    const res = await pdfExtractText(pdf, { mergePages: true });
    text = Array.isArray(res.text) ? res.text.join('\n') : res.text;
  } catch {
    text = '';
  }
  if (text.trim().length < 40) {
    // Fallback OCR per visure scansionate (PDF immagine).
    const { getOcr } = await import('@/lib/providers/ocr');
    const ocr = await getOcr();
    text = (await ocr.extractText(input)).text;
  }
  return parseVisuraText(text);
}
