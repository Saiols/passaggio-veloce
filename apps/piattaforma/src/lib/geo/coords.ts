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

/** Distanza in km tra due coordinate (Haversine, R=6371 km). */
export function distanceKm(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}
