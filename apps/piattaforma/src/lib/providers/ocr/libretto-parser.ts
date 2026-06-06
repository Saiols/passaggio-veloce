import type { LibrettoCircolazioneData } from './types';

const TARGA_RE = /\b([A-Z]{2}\d{3}[A-Z]{2})\b/;
const TELAIO_RE = /\b([A-HJ-NPR-Z0-9]{17})\b/;
const DATE = String.raw`(\d{2})[./-](\d{2})[./-](\d{4})`;

// La carta di circolazione riporta sul retro la legenda "SIGNIFICATO DEI CODICI
// COMUNITARI ARMONIZZATI", dove gli stessi codici (C.2.1, (I), ...) compaiono
// come DESCRIZIONI. Parsiamo solo la sezione dati (prima della legenda) per
// ancorarci ai valori reali e non alle definizioni.
const LEGEND_HEADER = 'SIGNIFICATO DEI CODICI';

/** Converte una data testuale (dd/mm/yyyy, dd.mm.yyyy, dd-mm-yyyy) in ISO yyyy-mm-dd. */
function toIso(d: string, m: string, y: string): string {
  return `${y}-${m}-${d}`;
}

/** Estrae la prima data che segue un codice (es. "(B)") nella sezione dati. */
function dateAfter(text: string, labelPattern: string): { iso: string; year: number } | undefined {
  const m = new RegExp(labelPattern + String.raw`\s*` + DATE).exec(text);
  if (!m) return undefined;
  return { iso: toIso(m[1]!, m[2]!, m[3]!), year: Number(m[3]) };
}

/** Estrae il valore testuale che segue un codice, fino a fine riga o prossimo "(". */
function fieldAfter(text: string, labelPattern: string): string | undefined {
  const m = new RegExp(labelPattern + String.raw`\s*([^\n(]+)`).exec(text);
  const v = m?.[1]?.trim();
  return v && v.length > 0 ? v : undefined;
}

/** Estrae i campi del libretto dal testo OCR. Tutti i campi sono best-effort:
 * un campo non trovato resta undefined (la pre-compilazione è editabile). */
export function parseLibrettoText(text: string, confidence: number): LibrettoCircolazioneData {
  const upper = text.toUpperCase();
  const legendIdx = upper.indexOf(LEGEND_HEADER);
  const data = legendIdx >= 0 ? upper.slice(0, legendIdx) : upper;

  const targa = TARGA_RE.exec(data)?.[1];
  const telaio = TELAIO_RE.exec(data)?.[1];

  // (B) data della prima immatricolazione; fallback alla prima data trovata.
  const immat =
    dateAfter(data, String.raw`\(B\)`) ??
    (() => {
      const m = new RegExp(DATE).exec(data);
      return m ? { iso: toIso(m[1]!, m[2]!, m[3]!), year: Number(m[3]) } : undefined;
    })();
  const dataImmatricolazione = immat?.iso;

  // (I) data di immatricolazione cui si riferisce la carta = data di acquisto
  // dell'attuale proprietario. L'OCR rende spesso "(I)" come "(1)" o "(L)".
  const acquisto = dateAfter(data, String.raw`\((?:I|1|L)\)`);
  const dataAcquisto = acquisto?.iso;

  // Proprietario attuale: (C.2.1) cognome o ragione sociale + (C.2.2) nome.
  const cognome = fieldAfter(data, String.raw`\(C\.2\.1\)`);
  const nome = fieldAfter(data, String.raw`\(C\.2\.2\)`);
  const intestatario = [cognome, nome].filter(Boolean).join(' ').trim();
  const proprietarioAttuale = intestatario.length ? intestatario : undefined;
  const proprietari = proprietarioAttuale ? [proprietarioAttuale] : undefined;

  // pre-2015 = regime Certificato di Proprietà, determinato dalla data di
  // ACQUISTO dell'attuale proprietario (I); fallback alla prima immatricolazione.
  const annoRegime = acquisto?.year ?? immat?.year;
  const preImm2015 = annoRegime !== undefined && annoRegime < 2015;

  return {
    targa,
    telaio,
    dataImmatricolazione,
    dataAcquisto,
    proprietarioAttuale,
    proprietari,
    preImm2015,
    flagComodatoDuso: /COMODATO/.test(data),
    confidenceScore: confidence,
    rawText: text,
  };
}
