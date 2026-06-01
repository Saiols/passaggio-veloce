/** Giorni dopo cui un Documento soft-deleted viene hard-deleted. */
export const DOC_HARD_DELETE_DAYS = 90;

/** Giorni dopo cui una Pratica in BOZZA non finalizzata viene purgata (par. 0.5). */
export const BOZZA_PURGE_DAYS = 30;

/** Data di taglio = now - days. Pura (now iniettabile per i test). */
export function cutoffDate(days: number, now: Date): Date {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}
