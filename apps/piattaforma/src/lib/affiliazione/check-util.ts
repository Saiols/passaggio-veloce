/**
 * Tipi e helper puri del detector anti-collusione (AF-AC). Niente import
 * server-only qui: questo file deve restare unit-testable senza setup
 * Node/Prisma e importabile anche da Client Components per render dei flag.
 */

export type CollusionFlag =
  | 'SAME_IBAN'
  | 'SAME_IP_SIGNUP'
  | 'SAME_EMAIL_DOMAIN'
  | 'SAME_ADMIN';

const FLAG_LABELS: Record<CollusionFlag, string> = {
  SAME_IBAN: 'Stesso IBAN',
  SAME_IP_SIGNUP: 'Stesso IP di signup',
  SAME_EMAIL_DOMAIN: 'Stesso dominio email aziendale',
  SAME_ADMIN: 'Stesso utente admin condiviso',
};

/** Etichetta umana per ogni flag (UI admin). */
export function flagLabel(f: CollusionFlag): string {
  return FLAG_LABELS[f];
}
