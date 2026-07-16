import { classifyDocumento } from '@/lib/documenti/classifier';

export type RegistrationDocTipo =
  | 'CI_FRONTE'
  | 'CI_RETRO'
  | 'CODICE_FISCALE'
  | 'CODICE_FISCALE_RETRO'
  | 'VISURA_CAMERALE';

export type RegistrationDocInput = {
  tipo: RegistrationDocTipo;
  mimeType: string;
  sizeBytes: number;
  originalFilename: string;
};

export type DocValidationResult = { ok: true } | { ok: false; error: string };

export const REQUIRED_DOC_TIPI: readonly RegistrationDocTipo[] = [
  'CI_FRONTE',
  'CI_RETRO',
  'CODICE_FISCALE',
  'CODICE_FISCALE_RETRO',
  'VISURA_CAMERALE',
];

/**
 * Sottrae `months` mesi a una data, lavorando in UTC a granularità di giorno,
 * con clamp sull'ultimo giorno del mese target per evitare l'overflow di fine
 * mese (es. 31 agosto - 6 mesi → 28/29 febbraio, non 3 marzo).
 * Ritorna il timestamp (ms) di mezzanotte UTC del giorno risultante.
 */
function subtractMonthsUtcDay(base: Date, months: number): number {
  const totalMonth = base.getUTCMonth() - months;
  const targetYear = base.getUTCFullYear() + Math.floor(totalMonth / 12);
  const targetMonth = ((totalMonth % 12) + 12) % 12;
  const lastDayOfTarget = new Date(
    Date.UTC(targetYear, targetMonth + 1, 0),
  ).getUTCDate();
  const day = Math.min(base.getUTCDate(), lastDayOfTarget);
  return Date.UTC(targetYear, targetMonth, day);
}

/** Valida una data emissione visura: non futura e non oltre `maxAgeMonths` mesi.
 * Confronto a granularità giorno (UTC). */
export function isVisuraDateValid(
  visuraData: string,
  maxAgeMonths: number,
  now: Date = new Date(),
): DocValidationResult {
  const d = new Date(visuraData);
  if (Number.isNaN(d.getTime())) return { ok: false, error: 'Data della visura non valida' };
  const visuraDay = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const nowDay = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  if (visuraDay > nowDay) return { ok: false, error: 'La data della visura non può essere futura' };
  if (visuraDay < subtractMonthsUtcDay(now, maxAgeMonths)) {
    return { ok: false, error: `La visura camerale deve essere emessa da non più di ${maxAgeMonths} mesi` };
  }
  return { ok: true };
}

/**
 * Valida i documenti KYC della registrazione: tutti presenti e ciascuno passa
 * il gating rule-based (MIME/dimensione/naming). A differenza delle pratiche
 * (dove un FAILED viene comunque salvato), qui i documenti sono obbligatori:
 * il primo errore blocca la registrazione.
 *
 * NB: la data di emissione visura non è richiesta a mano: viene estratta dall'OCR
 * sulla visura camerale. La sua validità è in `lib/visura/validita.ts` (180 giorni).
 */
export function validateRegistrationDocuments(
  docs: RegistrationDocInput[],
): DocValidationResult {
  for (const tipo of REQUIRED_DOC_TIPI) {
    if (!docs.some((d) => d.tipo === tipo)) {
      return { ok: false, error: 'Carica tutti i documenti richiesti' };
    }
  }
  for (const doc of docs) {
    const r = classifyDocumento(doc);
    if (r.stato === 'FAILED') {
      return { ok: false, error: r.reason };
    }
  }
  return { ok: true };
}
