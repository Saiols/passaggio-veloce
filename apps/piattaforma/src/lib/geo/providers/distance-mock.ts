import { distanceKm } from '../coords';
import type { LatLng, RoadDistanceProvider } from '../road-distance';

/**
 * Provider di default (dev/test): nessuna rete. Ritorna la distanza in
 * linea d'aria (Haversine) convertita in metri e arrotondata, come stima
 * della distanza stradale. Usato quando `DISTANCE_PROVIDER` non è `google`
 * o manca la key — mai in produzione con Google configurato.
 */
export class MockDistanceProvider implements RoadDistanceProvider {
  readonly name = 'mock' as const;

  async distances(
    origin: LatLng,
    dests: { sedeId: string; coord: LatLng }[],
  ): Promise<Map<string, number>> {
    const result = new Map<string, number>();
    for (const d of dests) {
      result.set(d.sedeId, Math.round(distanceKm(origin, d.coord) * 1000));
    }
    return result;
  }
}
