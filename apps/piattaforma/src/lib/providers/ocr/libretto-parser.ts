import type { LibrettoCircolazioneData } from './types';

const TARGA_RE = /\b([A-Z]{2}\d{3}[A-Z]{2})\b/;
const TELAIO_RE = /\b([A-HJ-NPR-Z0-9]{17})\b/;
const DATE_RE = /\b(\d{2})[./-](\d{2})[./-](\d{4})\b/;

/** Converte una data testuale (dd/mm/yyyy, dd.mm.yyyy, dd-mm-yyyy) in ISO yyyy-mm-dd. */
function toIso(d: string, m: string, y: string): string {
  return `${y}-${m}-${d}`;
}

/** Estrae i campi del libretto dal testo OCR. Tutti i campi sono best-effort:
 * un campo non trovato resta undefined (la pre-compilazione è editabile). */
export function parseLibrettoText(text: string, confidence: number): LibrettoCircolazioneData {
  const upper = text.toUpperCase();
  const targa = TARGA_RE.exec(upper)?.[1];
  const telaio = TELAIO_RE.exec(upper)?.[1];
  const dm = DATE_RE.exec(upper);
  const dataImmatricolazione = dm ? toIso(dm[1]!, dm[2]!, dm[3]!) : undefined;
  const year = dm ? Number(dm[3]) : undefined;
  // Estrazione intestatario: cerca pattern su una singola riga (non attraversa newline)
  const propM = /(?:INTESTAT[OA] A|INTESTATARIO|C1\.1\)?\s*)[^\S\n]*([A-ZÀ-Ù'']+(?:[^\S\n]+[A-ZÀ-Ù'']+){1,3})/.exec(upper);
  const proprietarioAttuale = propM ? propM[1]!.trim() : undefined;
  return {
    targa,
    telaio,
    dataImmatricolazione,
    proprietarioAttuale,
    preImm2015: year !== undefined && year < 2015,
    flagComodatoDuso: /COMODATO/.test(upper),
    confidenceScore: confidence,
    rawText: text,
  };
}
