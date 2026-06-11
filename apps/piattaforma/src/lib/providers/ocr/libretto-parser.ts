import type { LibrettoCircolazioneData, OwnerInfo } from './types';
import { isValidCodiceFiscale } from '@/lib/kyc/match';

const TARGA_RE = /\b([A-Z]{2}\d{3}[A-Z]{2})\b/;
const TELAIO_RE = /\b([A-HJ-NPR-Z0-9]{17})\b/;
const CF_RE = /\b([A-Z]{6}\d{2}[A-Z]\d{2}[A-Z]\d{3}[A-Z])\b/;
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

/**
 * Estrae un intestatario dato il prefisso codice ("C\\.2" o "C\\.3").
 * Se è presente il "nome" (.2) → persona fisica (CF tra .2 e .3); altrimenti →
 * persona giuridica (P.IVA = 11 cifre nella finestra dopo .1).
 */
function parseOwner(data: string, prefix: string): OwnerInfo | undefined {
  const p1 = fieldAfter(data, `\\(${prefix}\\.1\\)`); // cognome o ragione sociale
  if (!p1) return undefined;
  const p2 = fieldAfter(data, `\\(${prefix}\\.2\\)`); // nome (assente per le aziende)
  const i1 = data.search(new RegExp(`\\(${prefix}\\.1\\)`));
  if (p2) {
    const i3 = data.search(new RegExp(`\\(${prefix}\\.3\\)`));
    const seg = i1 >= 0 ? data.slice(i1, i3 > i1 ? i3 : i1 + 400) : '';
    const cfM = CF_RE.exec(seg);
    const cf = cfM && isValidCodiceFiscale(cfM[1]!) ? cfM[1]! : undefined;
    return { isPersonaGiuridica: false, cognome: p1, nome: p2, cf, display: `${p1} ${p2}`.trim() };
  }
  const seg = i1 >= 0 ? data.slice(i1, i1 + 600) : '';
  const pivaM = /\b(\d{11})\b/.exec(seg);
  return { isPersonaGiuridica: true, ragioneSociale: p1, piva: pivaM ? pivaM[1] : undefined, display: p1 };
}

/** Telaio (VIN, 17 caratteri). I VIN non usano mai O/I/Q: se l'OCR li ha
 * introdotti (tipico: O al posto di 0) normalizziamo e ri-validiamo. */
function extractTelaio(data: string): string | undefined {
  const strict = TELAIO_RE.exec(data)?.[1];
  if (strict) return strict;
  const m = /\b[A-Z0-9]{17}\b/.exec(data);
  if (!m) return undefined;
  const norm = m[0].replace(/[OIQ]/g, (c) => (c === 'I' ? '1' : '0'));
  return TELAIO_RE.test(norm) ? norm : undefined;
}

// Ricevuta PRA / minivoltura: "DOCUMENTO NON VALIDO PER LA CIRCOLAZIONE" +
// "N. PROGRESSIVO PRA". Testo libero (niente codici armonizzati/legenda).
// L'intestatario è il COMMERCIANTE (azienda).
const DEALER_MARKER = 'PROGRESSIVO PRA';

/** Estrae l'intestatario (azienda commerciante) e la data di acquisto da una
 * ricevuta PRA. Ragione sociale = riga non vuota subito sopra la P.IVA (11 cifre);
 * data acquisto = "Scrittura Privata del GG-MM-AAAA". */
function parseRicevutaPra(data: string): {
  proprietariInfo: OwnerInfo[];
  dataAcquisto?: string;
} {
  const lines = data.split('\n').map((l) => l.trim());
  let owner: OwnerInfo | undefined;
  for (let i = 1; i < lines.length; i++) {
    if (/^\d{11}$/.test(lines[i]!)) {
      let j = i - 1;
      while (j >= 0 && !lines[j]) j--;
      const ragioneSociale = j >= 0 ? lines[j]! : undefined;
      if (ragioneSociale) {
        owner = { isPersonaGiuridica: true, ragioneSociale, piva: lines[i]!, display: ragioneSociale };
      }
      break;
    }
  }
  const sp = new RegExp(`SCRITTURA PRIVATA DEL\\s+${DATE}`).exec(data);
  const dataAcquisto = sp ? toIso(sp[1]!, sp[2]!, sp[3]!) : undefined;
  return { proprietariInfo: owner ? [owner] : [], dataAcquisto };
}

/** Estrae i campi del libretto dal testo OCR. Tutti i campi sono best-effort:
 * un campo non trovato resta undefined (la pre-compilazione è editabile). */
export function parseLibrettoText(text: string, confidence: number): LibrettoCircolazioneData {
  const upper = text.toUpperCase();
  const legendIdx = upper.indexOf(LEGEND_HEADER);
  const data = legendIdx >= 0 ? upper.slice(0, legendIdx) : upper;

  const targa = TARGA_RE.exec(data)?.[1];
  const telaio = extractTelaio(data);

  // (B) data della prima immatricolazione; fallback alla prima data trovata.
  const immat =
    dateAfter(data, String.raw`\(B\)`) ??
    (() => {
      const m = new RegExp(DATE).exec(data);
      return m ? { iso: toIso(m[1]!, m[2]!, m[3]!), year: Number(m[3]) } : undefined;
    })();
  const dataImmatricolazione = immat?.iso;

  // Una ricevuta PRA (minivoltura) è "DOCUMENTO NON VALIDO PER LA CIRCOLAZIONE",
  // a testo libero, SENZA codici armonizzati. Una carta di circolazione può però
  // riportare l'annotazione di un passaggio ("N. Progressivo PRA" + "Scrittura
  // Privata del ...") pur restando una carta col proprietario nei codici (C.2.x):
  // in quel caso NON è una ricevuta PRA e il proprietario va letto da (C.2.1)/(C.2.2),
  // non interpretato come azienda commerciante.
  const isRicevutaPra = data.includes(DEALER_MARKER) && !data.includes('(C.2.1)');

  let proprietariInfo: OwnerInfo[];
  let dataAcquisto: string | undefined;
  let annoAcquisto: number | undefined;

  if (isRicevutaPra) {
    // Ricevuta PRA (venditore commerciante): intestatario = azienda;
    // acquisto = data della scrittura privata.
    const pra = parseRicevutaPra(data);
    proprietariInfo = pra.proprietariInfo;
    dataAcquisto = pra.dataAcquisto;
    annoAcquisto = dataAcquisto ? Number(dataAcquisto.slice(0, 4)) : undefined;
  } else {
    // (I) data di immatricolazione cui si riferisce la carta = data di acquisto
    // dell'attuale proprietario. L'OCR rende spesso "(I)" come "(1)" o "(L)".
    const acquisto = dateAfter(data, String.raw`\((?:I|1|L)\)`);
    dataAcquisto = acquisto?.iso;
    annoAcquisto = acquisto?.year;
    // Intestatari: C.2 (proprietario) + C.3 (secondo intestatario/utilizzatore,
    // es. nei leasing). Ciascuno può essere azienda o persona.
    proprietariInfo = [parseOwner(data, 'C\\.2'), parseOwner(data, 'C\\.3')].filter(
      (o): o is OwnerInfo => o !== undefined,
    );
  }

  const proprietari = proprietariInfo.length ? proprietariInfo.map((o) => o.display) : undefined;
  const proprietarioAttuale = proprietariInfo[0]?.display;
  const proprietarioCf = proprietariInfo[0]?.cf;

  // pre-2015 = regime Certificato di Proprietà, determinato dalla data di
  // ACQUISTO dell'attuale proprietario; fallback alla prima immatricolazione.
  const annoRegime = annoAcquisto ?? immat?.year;
  const preImm2015 = annoRegime !== undefined && annoRegime < 2015;

  return {
    targa,
    telaio,
    dataImmatricolazione,
    dataAcquisto,
    proprietarioAttuale,
    proprietarioCf,
    proprietari,
    proprietariInfo,
    preImm2015,
    flagComodatoDuso: /COMODATO/.test(data),
    confidenceScore: confidence,
    rawText: text,
  };
}
