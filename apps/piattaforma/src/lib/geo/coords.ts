/**
 * Parsing difensivo di una coppia di coordinate (da FormData o querystring).
 * Puro e browser-safe (nessun import server-only): usato sia dal client che
 * dalle server action. Ritorna null se non finite o fuori dai range terrestri.
 */
export function parseCoords(
  lat: unknown,
  lng: unknown,
): { lat: number; lng: number } | null {
  const norm = (v: unknown): number => {
    if (typeof v === 'number') return v;
    if (typeof v === 'string' && v.trim() !== '') return Number(v);
    return NaN;
  };
  const la = norm(lat);
  const ln = norm(lng);
  if (!Number.isFinite(la) || !Number.isFinite(ln)) return null;
  if (la < -90 || la > 90 || ln < -180 || ln > 180) return null;
  return { lat: la, lng: ln };
}
