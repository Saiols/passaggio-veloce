/**
 * Helper per renderizzare in modo sicuro la ragione sociale di una company
 * che potrebbe essere stata eliminata definitivamente (item 17 release
 * 2026-05). Le pratiche storiche restano per audit, ma nominativi e
 * recapiti sono anonimizzati nelle viste correnti.
 */
export function formatRagioneSociale(
  c: { ragioneSociale: string; deletedAt: Date | null } | null | undefined,
  fallback: string = '(account eliminato)',
): string {
  if (!c) return fallback;
  if (c.deletedAt) return fallback;
  return c.ragioneSociale;
}
