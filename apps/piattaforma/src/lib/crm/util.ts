/**
 * Helper puri condivisi del modulo CRM. Niente import server-only qui:
 * questo file deve restare unit-testable senza setup Node/Prisma.
 *
 * La normalizzazione del telefono vive in `match/normalize.ts` (fonte unica).
 */

/** Stati pre-iscrizione (S0..S6). */
export function isPreIscrizione(status: string): boolean {
  return ['S0', 'S1', 'S2', 'S3', 'S4', 'S5', 'S6'].includes(status);
}
