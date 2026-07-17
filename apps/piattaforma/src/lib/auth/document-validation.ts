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
