/**
 * Distribuzione "una per azienda madre" (multi-sede): data una lista di sedi
 * candidate GIÀ ORDINATA per ranking, tiene solo la sede migliore di ciascuna
 * madre. Pura, niente IO.
 */
export function dedupeByMadre<T extends { companyId: string }>(eligible: readonly T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const c of eligible) {
    if (seen.has(c.companyId)) continue;
    seen.add(c.companyId);
    out.push(c);
  }
  return out;
}
