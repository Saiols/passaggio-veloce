/**
 * Colonne normalizzate di CrmContact. Un solo posto che le calcola: ogni write
 * path che tocca tel/wa/email/piva DEVE passare di qui, altrimenti le colonne
 * si desincronizzano in silenzio e il match torna a non trovare nulla.
 *
 * `null` e non `''`: in SQL la stringa vuota sarebbe una chiave uguale per
 * tutte le righe senza dato.
 */
import { normalizeTel, normalizeEmail, normalizePiva } from './normalize';

export type CrmNormFields = {
  telNorm: string | null;
  waNorm: string | null;
  emailNorm: string | null;
  pivaNorm: string | null;
};

const nullSeVuoto = (s: string): string | null => (s === '' ? null : s);

export function crmNormFields(input: {
  tel?: string | null;
  wa?: string | null;
  email?: string | null;
  piva?: string | null;
}): CrmNormFields {
  return {
    telNorm: nullSeVuoto(normalizeTel(input.tel)),
    waNorm: nullSeVuoto(normalizeTel(input.wa)),
    emailNorm: nullSeVuoto(normalizeEmail(input.email)),
    pivaNorm: nullSeVuoto(normalizePiva(input.piva)),
  };
}
