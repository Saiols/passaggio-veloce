import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('server-only', () => ({}));

const findMany = vi.fn();
const createMany = vi.fn();
vi.mock('@pv/db', () => ({
  prisma: {
    roadDistanceCache: {
      findMany: (...a: unknown[]) => findMany(...a),
      createMany: (...a: unknown[]) => createMany(...a),
    },
  },
}));

import { roadDistancesM, getDistanceProvider, type RoadDistanceProvider, type LatLng } from './road-distance';
import { GoogleDistanceMatrixProvider } from './providers/distance-google';
import { MockDistanceProvider } from './providers/distance-mock';
import { distanceKm } from './coords';

const ORIGIN: LatLng = { lat: 45.4642, lng: 9.19 }; // Milano
const SEDE_A = { sedeId: 'sede-a', coord: { lat: 45.47, lng: 9.2 } };
const SEDE_B = { sedeId: 'sede-b', coord: { lat: 45.5, lng: 9.3 } };
const SEDE_C = { sedeId: 'sede-c', coord: { lat: 45.6, lng: 9.4 } };

const haversineM = (dest: LatLng): number => Math.round(distanceKm(ORIGIN, dest) * 1000);

/** Fake provider iniettato: nessuna rete reale, comportamento controllato dal test. */
function fakeProvider(
  impl: (origin: LatLng, dests: { sedeId: string; coord: LatLng }[]) => Promise<Map<string, number>>,
): RoadDistanceProvider {
  return { name: 'mock', distances: vi.fn(impl) };
}

describe('roadDistancesM', () => {
  beforeEach(() => {
    findMany.mockReset();
    createMany.mockReset();
  });

  it('dests vuoto → mappa vuota, nessuna query né chiamata provider', async () => {
    const provider = fakeProvider(async () => new Map());
    const result = await roadDistancesM('pratica-1', ORIGIN, [], undefined, provider);

    expect(result.size).toBe(0);
    expect(findMany).not.toHaveBeenCalled();
    expect(provider.distances).not.toHaveBeenCalled();
    expect(createMany).not.toHaveBeenCalled();
  });

  it('cache miss → chiama il provider, scrive la cache, ritorna mappa completa', async () => {
    findMany.mockResolvedValue([]); // nessuna riga cachata
    createMany.mockResolvedValue({ count: 2 });
    const distancesSpy = vi.fn(async (_origin: LatLng, dests: { sedeId: string; coord: LatLng }[]) => {
      const m = new Map<string, number>();
      for (const d of dests) m.set(d.sedeId, 1234);
      return m;
    });
    const provider: RoadDistanceProvider = { name: 'mock', distances: distancesSpy };

    const result = await roadDistancesM('pratica-1', ORIGIN, [SEDE_A, SEDE_B], undefined, provider);

    expect(distancesSpy).toHaveBeenCalledTimes(1);
    expect(distancesSpy).toHaveBeenCalledWith(ORIGIN, [SEDE_A, SEDE_B]);
    expect(result.get('sede-a')).toBe(1234);
    expect(result.get('sede-b')).toBe(1234);
    expect(result.size).toBe(2);

    expect(createMany).toHaveBeenCalledTimes(1);
    const args = createMany.mock.calls[0][0];
    expect(args.skipDuplicates).toBe(true);
    expect(args.data).toEqual(
      expect.arrayContaining([
        { praticaId: 'pratica-1', sedeId: 'sede-a', distanzaM: 1234 },
        { praticaId: 'pratica-1', sedeId: 'sede-b', distanzaM: 1234 },
      ]),
    );
  });

  it('cache hit → nessuna chiamata al provider per le sedi già cachate', async () => {
    findMany.mockResolvedValue([
      { sedeId: 'sede-a', distanzaM: 900 },
      { sedeId: 'sede-b', distanzaM: 1500 },
    ]);
    const provider = fakeProvider(async () => new Map());

    const result = await roadDistancesM('pratica-1', ORIGIN, [SEDE_A, SEDE_B], undefined, provider);

    expect(result.get('sede-a')).toBe(900);
    expect(result.get('sede-b')).toBe(1500);
    expect(provider.distances).not.toHaveBeenCalled();
    expect(createMany).not.toHaveBeenCalled();
  });

  it('cache parziale → il provider è chiamato SOLO per le sedi mancanti', async () => {
    findMany.mockResolvedValue([{ sedeId: 'sede-a', distanzaM: 900 }]);
    createMany.mockResolvedValue({ count: 1 });
    const distancesSpy = vi.fn(async () => new Map([['sede-b', 2000]]));
    const provider: RoadDistanceProvider = { name: 'mock', distances: distancesSpy };

    const result = await roadDistancesM('pratica-1', ORIGIN, [SEDE_A, SEDE_B], undefined, provider);

    expect(distancesSpy).toHaveBeenCalledWith(ORIGIN, [SEDE_B]);
    expect(result.get('sede-a')).toBe(900);
    expect(result.get('sede-b')).toBe(2000);
  });

  it('provider che LANCIA (API down) → non lancia, ritorna Haversine*1000 e NON scrive cache', async () => {
    findMany.mockResolvedValue([]);
    const provider = fakeProvider(async () => {
      throw new Error('Google API down');
    });

    const result = await roadDistancesM('pratica-1', ORIGIN, [SEDE_A, SEDE_B], undefined, provider);

    expect(result.get('sede-a')).toBe(haversineM(SEDE_A.coord));
    expect(result.get('sede-b')).toBe(haversineM(SEDE_B.coord));
    expect(createMany).not.toHaveBeenCalled();
  });

  it('provider che rigetta la Promise (rejection) → stesso fail-open, nessuna eccezione propagata', async () => {
    findMany.mockResolvedValue([]);
    const provider = fakeProvider(() => Promise.reject(new Error('timeout')));

    await expect(
      roadDistancesM('pratica-1', ORIGIN, [SEDE_A], undefined, provider),
    ).resolves.toEqual(new Map([['sede-a', haversineM(SEDE_A.coord)]]));
    expect(createMany).not.toHaveBeenCalled();
  });

  it('provider che omette alcune sedi → quelle mancanti ricadono su Haversine, senza essere cachate', async () => {
    findMany.mockResolvedValue([]);
    createMany.mockResolvedValue({ count: 1 });
    const provider = fakeProvider(async () => new Map([['sede-a', 777]])); // sede-b assente

    const result = await roadDistancesM('pratica-1', ORIGIN, [SEDE_A, SEDE_B], undefined, provider);

    expect(result.get('sede-a')).toBe(777);
    expect(result.get('sede-b')).toBe(haversineM(SEDE_B.coord));

    expect(createMany).toHaveBeenCalledTimes(1);
    const args = createMany.mock.calls[0][0];
    expect(args.data).toEqual([{ praticaId: 'pratica-1', sedeId: 'sede-a', distanzaM: 777 }]);
  });

  it('ritorna una mappa con TUTTE le dests anche in scenari misti (cache + provider + fallback)', async () => {
    findMany.mockResolvedValue([{ sedeId: 'sede-a', distanzaM: 500 }]);
    createMany.mockResolvedValue({ count: 1 });
    const provider = fakeProvider(async () => new Map([['sede-b', 999]])); // sede-c assente

    const result = await roadDistancesM(
      'pratica-1',
      ORIGIN,
      [SEDE_A, SEDE_B, SEDE_C],
      undefined,
      provider,
    );

    expect(result.size).toBe(3);
    expect(result.get('sede-a')).toBe(500); // da cache
    expect(result.get('sede-b')).toBe(999); // da provider
    expect(result.get('sede-c')).toBe(haversineM(SEDE_C.coord)); // fallback Haversine
  });

  it('usa il client di transazione (tx) quando passato, non il prisma globale', async () => {
    const txFindMany = vi.fn().mockResolvedValue([]);
    const txCreateMany = vi.fn().mockResolvedValue({ count: 1 });
    const tx = { roadDistanceCache: { findMany: txFindMany, createMany: txCreateMany } } as never;
    const provider = fakeProvider(async () => new Map([['sede-a', 111]]));

    await roadDistancesM('pratica-1', ORIGIN, [SEDE_A], tx, provider);

    expect(txFindMany).toHaveBeenCalledTimes(1);
    expect(txCreateMany).toHaveBeenCalledTimes(1);
    expect(findMany).not.toHaveBeenCalled();
    expect(createMany).not.toHaveBeenCalled();
  });
});

describe('getDistanceProvider', () => {
  const OLD_DISTANCE_PROVIDER = process.env.DISTANCE_PROVIDER;
  const OLD_MATRIX_KEY = process.env.GOOGLE_DISTANCE_MATRIX_API_KEY;
  const OLD_GEOCODING_KEY = process.env.GOOGLE_GEOCODING_API_KEY;

  function restore(name: string, old: string | undefined): void {
    if (old === undefined) delete process.env[name];
    else process.env[name] = old;
  }

  afterEach(() => {
    restore('DISTANCE_PROVIDER', OLD_DISTANCE_PROVIDER);
    restore('GOOGLE_DISTANCE_MATRIX_API_KEY', OLD_MATRIX_KEY);
    restore('GOOGLE_GEOCODING_API_KEY', OLD_GEOCODING_KEY);
  });

  it('default (nessuna env) → Mock', () => {
    delete process.env.DISTANCE_PROVIDER;
    delete process.env.GOOGLE_DISTANCE_MATRIX_API_KEY;
    delete process.env.GOOGLE_GEOCODING_API_KEY;
    expect(getDistanceProvider()).toBeInstanceOf(MockDistanceProvider);
  });

  it('DISTANCE_PROVIDER=google ma nessuna key → resta Mock', () => {
    process.env.DISTANCE_PROVIDER = 'google';
    delete process.env.GOOGLE_DISTANCE_MATRIX_API_KEY;
    delete process.env.GOOGLE_GEOCODING_API_KEY;
    expect(getDistanceProvider()).toBeInstanceOf(MockDistanceProvider);
  });

  it('key presente ma DISTANCE_PROVIDER non è "google" → resta Mock', () => {
    delete process.env.DISTANCE_PROVIDER;
    process.env.GOOGLE_DISTANCE_MATRIX_API_KEY = 'a-key';
    expect(getDistanceProvider()).toBeInstanceOf(MockDistanceProvider);
  });

  it('DISTANCE_PROVIDER=google + GOOGLE_DISTANCE_MATRIX_API_KEY → Google', () => {
    process.env.DISTANCE_PROVIDER = 'google';
    process.env.GOOGLE_DISTANCE_MATRIX_API_KEY = 'matrix-key';
    delete process.env.GOOGLE_GEOCODING_API_KEY;
    expect(getDistanceProvider()).toBeInstanceOf(GoogleDistanceMatrixProvider);
  });

  it('DISTANCE_PROVIDER=google + solo GOOGLE_GEOCODING_API_KEY (fallback) → Google', () => {
    process.env.DISTANCE_PROVIDER = 'google';
    delete process.env.GOOGLE_DISTANCE_MATRIX_API_KEY;
    process.env.GOOGLE_GEOCODING_API_KEY = 'geocoding-key';
    expect(getDistanceProvider()).toBeInstanceOf(GoogleDistanceMatrixProvider);
  });
});

describe('MockDistanceProvider', () => {
  it('ritorna Haversine*1000 arrotondato per ogni dest, senza rete', async () => {
    const provider = new MockDistanceProvider();
    const result = await provider.distances(ORIGIN, [SEDE_A, SEDE_B]);
    expect(result.get('sede-a')).toBe(haversineM(SEDE_A.coord));
    expect(result.get('sede-b')).toBe(haversineM(SEDE_B.coord));
  });
});

describe('GoogleDistanceMatrixProvider', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('parsa rows[0].elements[].distance.value per gli elementi OK', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({
        status: 'OK',
        rows: [
          {
            elements: [
              { status: 'OK', distance: { value: 4200 } },
              { status: 'OK', distance: { value: 8100 } },
            ],
          },
        ],
      }),
    });
    const provider = new GoogleDistanceMatrixProvider('test-key');
    const result = await provider.distances(ORIGIN, [SEDE_A, SEDE_B]);
    expect(result.get('sede-a')).toBe(4200);
    expect(result.get('sede-b')).toBe(8100);
  });

  it('omette gli elementi con status non-OK dalla mappa', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({
        status: 'OK',
        rows: [
          {
            elements: [
              { status: 'OK', distance: { value: 4200 } },
              { status: 'ZERO_RESULTS' },
            ],
          },
        ],
      }),
    });
    const provider = new GoogleDistanceMatrixProvider('test-key');
    const result = await provider.distances(ORIGIN, [SEDE_A, SEDE_B]);
    expect(result.get('sede-a')).toBe(4200);
    expect(result.has('sede-b')).toBe(false);
  });

  it('status top-level non-OK → mappa vuota per quel batch (nessuna eccezione)', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'REQUEST_DENIED' }),
    });
    const provider = new GoogleDistanceMatrixProvider('test-key');
    const result = await provider.distances(ORIGIN, [SEDE_A]);
    expect(result.size).toBe(0);
  });

  it('errore di rete → mappa vuota, nessuna eccezione propagata', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('network down'));
    const provider = new GoogleDistanceMatrixProvider('test-key');
    const result = await provider.distances(ORIGIN, [SEDE_A]);
    expect(result.size).toBe(0);
  });

  it('risposta HTTP non-ok → mappa vuota, nessuna eccezione', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: false });
    const provider = new GoogleDistanceMatrixProvider('test-key');
    const result = await provider.distances(ORIGIN, [SEDE_A]);
    expect(result.size).toBe(0);
  });

  it('batcha in chunk di al più 25 destinazioni per richiesta', async () => {
    const dests = Array.from({ length: 30 }, (_, i) => ({
      sedeId: `sede-${i}`,
      coord: { lat: 45.5 + i * 0.001, lng: 9.2 },
    }));
    (fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation(async (url: string) => {
      const destParam = new URL(url).searchParams.get('destinations') ?? '';
      const count = destParam.split('|').length;
      return {
        ok: true,
        json: async () => ({
          status: 'OK',
          rows: [{ elements: Array.from({ length: count }, () => ({ status: 'OK', distance: { value: 1000 } })) }],
        }),
      };
    });
    const provider = new GoogleDistanceMatrixProvider('test-key');
    const result = await provider.distances(ORIGIN, dests);

    expect(fetch).toHaveBeenCalledTimes(2); // 30 dest → chunk 25 + 5
    expect(result.size).toBe(30);
  });

  it('include mode=driving e la key nella query string', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'OK', rows: [{ elements: [{ status: 'OK', distance: { value: 100 } }] }] }),
    });
    const provider = new GoogleDistanceMatrixProvider('my-key');
    await provider.distances(ORIGIN, [SEDE_A]);
    const url = String((fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0]);
    expect(url).toContain('mode=driving');
    expect(url).toContain('key=my-key');
    expect(url).toContain('maps.googleapis.com/maps/api/distancematrix/json');
  });
});
