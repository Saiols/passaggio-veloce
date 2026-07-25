/**
 * Metri → etichetta in km per la UI admin ("1,3 km"). Il motore lavora in
 * metri: la conversione sta qui, in un solo posto, e non nei componenti.
 *
 * Puro e browser-safe (nessun import server-only): usabile anche da un client
 * component.
 */
export function formatKm(metri: number): string {
  const km = metri / 1000;
  // Sotto il km il decimale singolo è troppo grosso (0,3 km per 250 m):
  // in quel caso si mostrano i metri.
  if (km < 1) return `${Math.round(metri)} m`;
  return `${km.toLocaleString('it-IT', { maximumFractionDigits: 1 })} km`;
}
