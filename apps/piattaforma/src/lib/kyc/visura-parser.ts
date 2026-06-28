import 'server-only';
import type { OcrExtractInput } from '@/lib/providers/ocr';

export type VisuraData = {
  dataEmissione?: string; // ISO yyyy-mm-dd
  ateco?: string; // codice primario (per messaggi/display)
  atecoCodes?: string[]; // TUTTI i codici ATECO trovati (una visura ne riporta più d'uno)
  denominazione?: string;
  partitaIva?: string;
  amministratore?: { nome?: string; cognome?: string; codiceFiscale?: string };
  rawText: string;
};

const CF_INNER = "[A-Z]{6}\\d{2}[A-Z]\\d{2}[A-Z]\\d{3}[A-Z]";
const PIVA_RE = /\b(\d{11})\b/;
// Codice ATECO/NACE: 2 parti (47.81) o 3 parti (47.81.10). NB: le date usano "/",
// quindi "\d{2}\.\d{2}" non intercetta date.
const ATECO_RE = /\b(\d{2}\.\d{2}(?:\.\d{1,2})?)\b/g;

/**
 * Parsing best-effort del testo di una visura camerale InfoCamere/CCIAA.
 * Puro/testabile. Calibrato sul layout reale del Registro Imprese.
 */
export function parseVisuraText(text: string): VisuraData {
  const out: VisuraData = { rawText: text };
  const upper = text.toUpperCase();

  // Denominazione: "Denominazione: X" fino al campo successivo. Non determinante
  // (il match azienda usa soprattutto la P.IVA), ma utile come fallback.
  const denom = /Denominazione:\s*([^\n]{2,80}?)\s+(?:Data atto|Codice fiscale|Codice Fiscale|Visura)/i.exec(text);
  if (denom) out.denominazione = denom[1]!.trim();

  const piva = PIVA_RE.exec(upper);
  if (piva) out.partitaIva = piva[1];

  // ATECO: raccogli TUTTI i codici (la visura riporta sia l'ATECO 2025 sia
  // l'ATECORI 2007-2022, es. 47.81.10 e 45.11.01). Il gate accetta se ALMENO uno
  // è ammesso.
  const codes = [...upper.matchAll(ATECO_RE)].map((m) => m[1]!);
  out.atecoCodes = [...new Set(codes)];
  out.ateco = out.atecoCodes[0];

  // Data emissione: la frase ufficiale InfoCamere. NON usare un generico "estratt"
  // perché il disclaimer in cima ("viene esposto un estratto delle informazioni")
  // farebbe pescare la prima data utile (es. data costituzione).
  const date = /estratto dal Registro Imprese in data\s+(\d{2})\/(\d{2})\/(\d{4})/i.exec(text);
  if (date) out.dataEmissione = `${date[3]}-${date[2]}-${date[1]}`;

  out.amministratore = parseAmministratore(text);
  return out;
}

/**
 * Estrae l'amministratore/rappresentante dalla sezione "Amministratori" della
 * visura (InfoCamere): la carica è seguita dal nome (COGNOME NOME) e, poco dopo,
 * da "Codice fiscale: XXX". Si lavora su una finestra che parte dalla sezione
 * amministratori, così il primo CF della finestra è quello dell'amministratore
 * (i CF dei soci stanno in una sezione precedente).
 *
 * Per le IMPRESE INDIVIDUALI non esiste la sezione "Amministratori": il legale
 * rappresentante è il "Titolare" (sezione "Titolari di cariche o qualifiche",
 * carica "Titolare Firmatario"); il suo CF coincide con quello dell'impresa.
 */
function parseAmministratore(text: string): VisuraData['amministratore'] {
  const startIdx = (() => {
    // Ordine: prima le sezioni "amministratori" (società di capitale/persone),
    // poi il "Titolare Firmatario" delle imprese individuali. Si ancora alla
    // sezione di dettaglio (non all'indice), così la finestra contiene nome+CF.
    for (const re of [
      /Elenco amministratori/i,
      /\bAmministratori\b/,
      /Titolare Firmatario/i,
      /Titolari di cariche/i,
    ]) {
      const i = text.search(re);
      if (i >= 0) return i;
    }
    return 0;
  })();
  const region = text.slice(startIdx, startIdx + 1500);

  // Carica (case-sensitive: nelle visure è "Amministratore Unico" maiuscolo) seguita
  // dal nome in MAIUSCOLO, fino a "Rappresentante"/"Nato"/"Codice fiscale". Le varianti
  // "Titolare …" (più lunghe prima) coprono le imprese individuali.
  // GENDER-AGNOSTIC: una visura usa il femminile quando l'amministratore è una donna
  // ("Amministratrice Unica", "Consigliera Delegata", "Socia Amministratrice",
  // "Liquidatrice", "Presidentessa") — `(?:ore|rice)` / `Unic[ao]` / `[ae]` coprono
  // entrambi i generi. Le forme "Unic[ao]"/"Delegat[ao]"/"Soci[ao] Amministrat…" vanno
  // PRIMA della bare "Amministrat(?:ore|rice)" così la carica consuma anche "Unica/Delegata".
  const caricaRe =
    /(?:Amministrat(?:ore|rice)\s+Unic[ao]|Amministrat(?:ore|rice)\s+Delegat[ao]|Consiglier[ae]\s+Delegat[ao]|Soci[ao]\s+Amministrat(?:ore|rice)|Amministrat(?:ore|rice)|Presidente del Consiglio[^\n]{0,40}|Presidentessa|Presidente|Liquidat(?:ore|rice)|Consiglier[ae]|Titolare Firmatario|Titolare di impresa individuale|Titolare)\s+([A-ZÀ-Ù'’]{2,}(?:\s+[A-ZÀ-Ù'’]{2,}){1,3}?)\s+(?:Rappresentante|Nato|Nata|Codice fiscale)/;
  const m = caricaRe.exec(region);
  let nome: string | undefined;
  let cognome: string | undefined;
  if (m) {
    const tokens = m[1]!.trim().split(/\s+/);
    cognome = tokens[0]; // InfoCamere: COGNOME NOME
    nome = tokens.slice(1).join(' ') || undefined;
  }

  const cfm = new RegExp(`Codice fiscale:?\\s*(${CF_INNER})`, 'i').exec(region);
  const codiceFiscale = cfm ? cfm[1]!.toUpperCase() : undefined;

  if (!nome && !cognome && !codiceFiscale) return undefined;
  return { nome, cognome, codiceFiscale };
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
