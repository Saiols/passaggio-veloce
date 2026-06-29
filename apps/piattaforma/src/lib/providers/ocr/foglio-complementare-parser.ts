import type { LibrettoCircolazioneData, OwnerInfo } from './types';

/**
 * Parser del FOGLIO COMPLEMENTARE (ricevuta PRA: "DOCUMENTO NON VALIDO PER LA
 * CIRCOLAZIONE", art. 56 D.Lgs. 446/1997). Subentra al libretto quando il
 * veicolo è intestato a un commerciante d'auto.
 *
 * Ritorna la stessa forma del libretto (LibrettoCircolazioneData) così da
 * alimentare la stessa pre-compilazione del wizard. Differenze chiave dal
 * libretto:
 *  - l'intestatario è SEMPRE l'azienda commerciante (ragione sociale + P.IVA);
 *  - NON c'è la data di prima immatricolazione (campo B) → dataImmatricolazione
 *    resta undefined (si inserisce a mano);
 *  - la data utile è quella della "Scrittura Privata" (acquisto del commerciante).
 *
 * Calibrato su due fogli reali (2026-06-29); da rivalidare sul testo OCR reale.
 */

const TARGA_RE = /\b([A-Z]{2}\d{3}[A-Z]{2})\b/;
// VIN: 17 caratteri, charset senza I/O/Q.
const VIN_RE = /\b([A-HJ-NPR-Z0-9]{17})\b/;
const PIVA_RE = /^\d{11}$/;
const DATE = String.raw`(\d{2})[./-](\d{2})[./-](\d{4})`;

function toIso(d: string, m: string, y: string): string {
  return `${y}-${m}-${d}`;
}

/** Telaio (VIN, 17 char). Se l'OCR ha introdotto O/I (mai validi nei VIN) li
 * normalizza a 0/1 e ri-valida. Sul foglio l'omologazione (≤12 char) non
 * collide con la lunghezza 17, quindi il primo token da 17 è il VIN. */
function extractVin(upper: string): string | undefined {
  const strict = VIN_RE.exec(upper)?.[1];
  if (strict) return strict;
  const m = /\b[A-Z0-9]{17}\b/.exec(upper);
  if (!m) return undefined;
  const norm = m[0].replace(/[OIQ]/g, (c) => (c === 'I' ? '1' : '0'));
  return VIN_RE.test(norm) ? norm : undefined;
}

/** Intestatario commerciante: ragione sociale = riga non vuota subito sopra la
 * P.IVA (11 cifre su riga propria), come sulle ricevute PRA. */
function extractIntestatario(upper: string): OwnerInfo | undefined {
  const lines = upper.split('\n').map((l) => l.trim());
  for (let i = 1; i < lines.length; i++) {
    if (PIVA_RE.test(lines[i]!)) {
      let j = i - 1;
      while (j >= 0 && !lines[j]) j--;
      const ragioneSociale = j >= 0 ? lines[j]! : undefined;
      if (!ragioneSociale) return undefined;
      return {
        isPersonaGiuridica: true,
        ragioneSociale,
        piva: lines[i]!,
        display: ragioneSociale,
      };
    }
  }
  return undefined;
}

/** Data di acquisto del commerciante: "Scrittura Privata del GG-MM-AAAA". */
function extractDataScrittura(upper: string): string | undefined {
  const m = new RegExp(`SCRITTURA PRIVATA DEL\\s+${DATE}`).exec(upper);
  return m ? toIso(m[1]!, m[2]!, m[3]!) : undefined;
}

export function parseFoglioComplementareText(
  text: string,
  confidence: number,
): LibrettoCircolazioneData {
  const upper = text.toUpperCase();

  const targa = TARGA_RE.exec(upper)?.[1];
  const telaio = extractVin(upper);
  const owner = extractIntestatario(upper);
  const dataAcquisto = extractDataScrittura(upper);

  // Il foglio complementare appartiene al regime digitale post-2015; la data di
  // immatricolazione non è riportata. Il regime pre/post-2015 si basa quindi
  // sulla data di acquisto del commerciante (di norma post-2015 → false).
  const annoAcquisto = dataAcquisto ? Number(dataAcquisto.slice(0, 4)) : undefined;
  const preImm2015 = annoAcquisto !== undefined && annoAcquisto < 2015;

  return {
    targa,
    telaio,
    dataImmatricolazione: undefined, // assente sul foglio complementare
    dataAcquisto,
    proprietarioAttuale: owner?.display,
    proprietarioCf: undefined, // intestatario azienda → nessun CF persona fisica
    proprietari: owner ? [owner.display] : undefined,
    proprietariInfo: owner ? [owner] : undefined,
    preImm2015,
    flagComodatoDuso: /COMODATO/.test(upper),
    confidenceScore: confidence,
    rawText: text,
  };
}
