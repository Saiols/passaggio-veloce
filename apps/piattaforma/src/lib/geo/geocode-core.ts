export type GeocodeInput = {
  indirizzo: string;
  civico?: string | null;
  citta: string;
  cap: string;
  provincia: string;
};

const ENDPOINT = 'https://maps.googleapis.com/maps/api/geocode/json';

/** Compone l'indirizzo in una singola stringa per la query di geocoding. */
export function formatAddress(a: GeocodeInput): string {
  const via = [a.indirizzo, a.civico].filter(Boolean).join(' ').trim();
  return [via, `${a.cap} ${a.citta}`.trim(), a.provincia, 'Italia']
    .filter((s) => s && s.length > 0)
    .join(', ');
}

/**
 * Chiave per le chiamate server-side al Geocoding.
 *
 * Si usa `GOOGLE_GEOCODING_API_KEY`: una chiave dedicata, NON esposta al
 * browser, senza restrizione per referrer e ristretta alla sola Geocoding API.
 * Serve una chiave separata perché `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` è pubblica
 * (finisce nel bundle) e per questo è protetta da una restrizione per referrer
 * HTTP — che Google rifiuta sulle chiamate server, prive di referrer:
 * «API keys with referer restrictions cannot be used with this API».
 * Toglierle quella restrizione la renderebbe utilizzabile da chiunque la peschi
 * dal bundle, a consumo sul nostro budget.
 *
 * Fallback sulla chiave pubblica per gli ambienti dove quella dedicata non è
 * configurata (es. dev locale): lì funziona solo se non ha restrizioni referrer,
 * altrimenti geocodeAddress ritorna null e le coordinate restano da backfillare.
 */
function geocodingKey(): string | undefined {
  return process.env.GOOGLE_GEOCODING_API_KEY ?? process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
}

/**
 * Geocoda un indirizzo con la Google Geocoding API. Tollerante: ritorna null su
 * chiave mancante, ZERO_RESULTS, risposta non-OK, errore di rete/quota. Non
 * lancia mai — il chiamante tratta null come "coordinate non disponibili".
 */
export async function geocodeAddress(
  a: GeocodeInput,
): Promise<{ lat: number; lng: number } | null> {
  const key = geocodingKey();
  if (!key) return null;
  const url = `${ENDPOINT}?address=${encodeURIComponent(formatAddress(a))}&region=it&key=${key}`;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = (await res.json()) as {
      status: string;
      results?: Array<{ geometry?: { location?: { lat: number; lng: number } } }>;
    };
    if (data.status !== 'OK') return null;
    const loc = data.results?.[0]?.geometry?.location;
    if (!loc || typeof loc.lat !== 'number' || typeof loc.lng !== 'number') return null;
    return { lat: loc.lat, lng: loc.lng };
  } catch {
    return null;
  }
}
