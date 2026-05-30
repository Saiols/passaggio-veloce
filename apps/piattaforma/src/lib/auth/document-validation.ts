import { classifyDocumento } from '@/lib/documenti/classifier';

export type RegistrationDocTipo =
  | 'CI_FRONTE'
  | 'CI_RETRO'
  | 'CODICE_FISCALE'
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
  'VISURA_CAMERALE',
];

const VISURA_MAX_AGE_MONTHS = 6;

/** Valida la data di emissione della visura: non futura e non oltre 6 mesi. */
export function validateVisuraData(
  visuraData: string,
  now: Date = new Date(),
): DocValidationResult {
  const d = new Date(visuraData);
  if (Number.isNaN(d.getTime())) {
    return { ok: false, error: 'Data della visura non valida' };
  }
  if (d.getTime() > now.getTime()) {
    return { ok: false, error: 'La data della visura non può essere futura' };
  }
  const limite = new Date(now);
  limite.setMonth(limite.getMonth() - VISURA_MAX_AGE_MONTHS);
  if (d.getTime() < limite.getTime()) {
    return {
      ok: false,
      error: 'La visura camerale deve essere emessa da non più di 6 mesi',
    };
  }
  return { ok: true };
}

/**
 * Valida i documenti KYC della registrazione: tutti presenti, ciascuno passa
 * il gating rule-based (MIME/dimensione/naming), visura entro 6 mesi.
 * A differenza delle pratiche (dove un FAILED viene comunque salvato), qui i
 * documenti sono obbligatori: il primo errore blocca la registrazione.
 */
export function validateRegistrationDocuments(
  docs: RegistrationDocInput[],
  visuraData: string,
  now: Date = new Date(),
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
  return validateVisuraData(visuraData, now);
}
