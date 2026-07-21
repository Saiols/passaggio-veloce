import type { LatLng, RoadDistanceProvider } from '../road-distance';

const ENDPOINT = 'https://maps.googleapis.com/maps/api/distancematrix/json';
/** Limite documentato dell'API: max 25 destinazioni per richiesta. */
const BATCH_SIZE = 25;
/** Timeout esplicito per non far dipendere il tick di distribuzione dalla
 * latenza di Google: oltre questa soglia il batch è considerato fallito. */
const TIMEOUT_MS = 8000;

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

type DistanceMatrixResponse = {
  status: string;
  rows?: Array<{
    elements?: Array<{ status: string; distance?: { value: number } }>;
  }>;
};

/**
 * Google Distance Matrix API (driving). Un solo `origin`, `destinations` in
 * batch da al più 25 (limite API), eseguiti in parallelo.
 *
 * Tollerante per-batch: qualunque errore di rete, timeout, risposta non-OK
 * (HTTP o `status` top-level) o elemento con `status !== 'OK'` fa sì che le
 * sedi di quel batch restino semplicemente assenti dalla mappa ritornata —
 * non lancia mai per un singolo batch fallito, per non buttare via i batch
 * riusciti. Il chiamante (`roadDistancesM`) tratta le sedi mancanti come
 * fallback Haversine.
 */
export class GoogleDistanceMatrixProvider implements RoadDistanceProvider {
  readonly name = 'google' as const;

  constructor(private readonly apiKey: string) {}

  async distances(
    origin: LatLng,
    dests: { sedeId: string; coord: LatLng }[],
  ): Promise<Map<string, number>> {
    const result = new Map<string, number>();
    if (dests.length === 0) return result;

    const batches = chunk(dests, BATCH_SIZE);
    await Promise.all(batches.map((batch) => this.fetchBatch(origin, batch, result)));
    return result;
  }

  private async fetchBatch(
    origin: LatLng,
    batch: { sedeId: string; coord: LatLng }[],
    result: Map<string, number>,
  ): Promise<void> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const origins = `${origin.lat},${origin.lng}`;
      const destinations = batch.map((d) => `${d.coord.lat},${d.coord.lng}`).join('|');
      const url =
        `${ENDPOINT}?origins=${encodeURIComponent(origins)}` +
        `&destinations=${encodeURIComponent(destinations)}` +
        `&mode=driving&key=${this.apiKey}`;

      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) return;

      const data = (await res.json()) as DistanceMatrixResponse;
      if (data.status !== 'OK') return;

      const elements = data.rows?.[0]?.elements ?? [];
      batch.forEach((d, i) => {
        const el = elements[i];
        if (el && el.status === 'OK' && typeof el.distance?.value === 'number') {
          result.set(d.sedeId, el.distance.value);
        }
      });
    } catch {
      // Rete/timeout/parsing: il batch resta assente dalla mappa (fail-open
      // gestito a monte da roadDistancesM, che ricade su Haversine).
    } finally {
      clearTimeout(timeoutId);
    }
  }
}
