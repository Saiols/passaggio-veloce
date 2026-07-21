import 'server-only';
import { prisma, type Prisma, type PrismaClient } from '@pv/db';
import { distanceKm } from './coords';
import { GoogleDistanceMatrixProvider } from './providers/distance-google';
import { MockDistanceProvider } from './providers/distance-mock';

export type LatLng = { lat: number; lng: number };

export type RoadDistanceProviderName = 'google' | 'mock';

export interface RoadDistanceProvider {
  readonly name: RoadDistanceProviderName;
  /**
   * Metri stradali per ogni sede destinazione. Una sede assente dalla mappa
   * ritornata significa "non calcolabile" (timeout/status non-OK/quota): il
   * chiamante (`roadDistancesM`) ricade su Haversine per quella sede.
   */
  distances(
    origin: LatLng,
    dests: { sedeId: string; coord: LatLng }[],
  ): Promise<Map<string, number>>;
}

type DistanceClient = PrismaClient | Prisma.TransactionClient;

/**
 * Chiave per la Google Distance Matrix API. Dedicata se configurata,
 * altrimenti ripiega sulla stessa server-key già in uso per il Geocoding
 * (`GOOGLE_GEOCODING_API_KEY`, vedi `geocode-core.ts`): chiave server-side
 * senza restrizione referrer, utilizzabile per chiamate senza browser.
 * Letta via `process.env` diretto (non nello schema validato `env.ts`),
 * come la key del geocoding — stesso pattern, stessa ragione (opzionale,
 * attivabile per ambiente senza toccare lo schema condiviso).
 */
function distanceMatrixKey(): string | undefined {
  return process.env.GOOGLE_DISTANCE_MATRIX_API_KEY ?? process.env.GOOGLE_GEOCODING_API_KEY;
}

/**
 * Seleziona il provider di distanza stradale. Google SOLO se esplicitamente
 * abilitato (`DISTANCE_PROVIDER=google`) e una key è presente; in ogni altro
 * caso (dev/test di default, key assente) → Mock (Haversine), nessuna
 * chiamata di rete. Nessuna memoizzazione: la selezione rilegge l'env a ogni
 * chiamata (costruzione economica, coerente con i test che cambiano l'env
 * tra un caso e l'altro).
 */
export function getDistanceProvider(): RoadDistanceProvider {
  const key = distanceMatrixKey();
  if (process.env.DISTANCE_PROVIDER === 'google' && key) {
    return new GoogleDistanceMatrixProvider(key);
  }
  return new MockDistanceProvider();
}

/**
 * Distanza stradale per ogni sede destinazione, con cache persistente
 * (`RoadDistanceCache`, unique `(praticaId, sedeId)`) e fail-open su
 * Haversine (km*1000, arrotondato) quando il provider fallisce o omette una
 * sede.
 *
 * Ordine: (1) legge la cache per le sedi richieste; (2) per le mancanti
 * chiama `provider.distances` dentro un try/catch; (3) i risultati ottenuti
 * vengono scritti in cache (`createMany`, `skipDuplicates`) e uniti al
 * risultato; (4) qualunque sede ancora mancante (provider fallito o sede
 * omessa dalla risposta) ricade su Haversine **transitorio, non cachato** —
 * così il tick successivo ritenta l'API reale. La distribuzione non si
 * blocca MAI su un blip esterno.
 *
 * `dests` vuoto → mappa vuota, nessuna query/chiamata.
 *
 * `provider` è iniettabile (default `getDistanceProvider()`) per i test:
 * un fake `RoadDistanceProvider` permette di simulare cache hit/miss e
 * provider down senza rete né Prisma reali.
 */
export async function roadDistancesM(
  praticaId: string,
  origin: LatLng,
  dests: { sedeId: string; coord: LatLng }[],
  tx?: DistanceClient,
  provider: RoadDistanceProvider = getDistanceProvider(),
): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  if (dests.length === 0) return result;

  const client = tx ?? prisma;
  const sedeIds = dests.map((d) => d.sedeId);

  const cached = await client.roadDistanceCache.findMany({
    where: { praticaId, sedeId: { in: sedeIds } },
  });
  for (const row of cached) result.set(row.sedeId, row.distanzaM);

  const missing = dests.filter((d) => !result.has(d.sedeId));
  if (missing.length === 0) return result;

  let fromProvider: Map<string, number> | null = null;
  try {
    fromProvider = await provider.distances(origin, missing);
  } catch {
    // Fail-open: API down/timeout/quota esaurita → Haversine sotto, nessuna
    // scrittura in cache (il tick successivo ritenta il provider reale).
    fromProvider = null;
  }

  if (fromProvider) {
    const toCache = missing.filter((d) => fromProvider!.has(d.sedeId));
    if (toCache.length > 0) {
      try {
        await client.roadDistanceCache.createMany({
          data: toCache.map((d) => ({
            praticaId,
            sedeId: d.sedeId,
            distanzaM: fromProvider!.get(d.sedeId)!,
          })),
          skipDuplicates: true,
        });
      } catch {
        // Scrittura cache best-effort: un blip di scrittura non deve buttare
        // via un risultato già calcolato con successo dal provider.
      }
      for (const d of toCache) result.set(d.sedeId, fromProvider.get(d.sedeId)!);
    }
    // Le sedi assenti dalla risposta del provider (status non-OK) restano
    // fuori da `result` qui e ricadono su Haversine sotto, senza cache.
  }

  for (const d of missing) {
    if (!result.has(d.sedeId)) {
      result.set(d.sedeId, Math.round(distanceKm(origin, d.coord) * 1000));
    }
  }

  return result;
}
