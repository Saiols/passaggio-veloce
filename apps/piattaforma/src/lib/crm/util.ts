/**
 * Helper puri condivisi del modulo CRM. Niente import server-only qui:
 * questo file deve restare unit-testable senza setup Node/Prisma.
 */

/** Normalizza telefono per il match: rimuove spazi, prefisso +39 opzionale. */
export function normalizePhone(raw: string): string {
  return raw.replace(/\s+/g, '').replace(/^\+39/, '');
}

/** Stati pre-iscrizione (S0..S6). */
export function isPreIscrizione(status: string): boolean {
  return ['S0', 'S1', 'S2', 'S3', 'S4', 'S5', 'S6'].includes(status);
}
