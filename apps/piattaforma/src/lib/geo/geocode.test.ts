import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('server-only', () => ({}));

import { formatAddress, geocodeAddress } from './geocode';

const ADDR = { indirizzo: 'Via Roma', civico: '10', citta: 'Milano', cap: '20100', provincia: 'MI' };

describe('formatAddress', () => {
  it('compone via civico, cap città, provincia, Italia', () => {
    expect(formatAddress(ADDR)).toBe('Via Roma 10, 20100 Milano, MI, Italia');
  });
  it('omette il civico se assente', () => {
    expect(formatAddress({ ...ADDR, civico: null })).toBe('Via Roma, 20100 Milano, MI, Italia');
  });
});

const mockedFetch = () => fetch as unknown as ReturnType<typeof vi.fn>;

/** Ripristina una env var al valore originale (delete se non c'era). */
function restoreEnv(name: string, old: string | undefined): void {
  if (old === undefined) delete process.env[name];
  else process.env[name] = old;
}

describe('geocodeAddress', () => {
  const OLD_PUBLIC = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  const OLD_SERVER = process.env.GOOGLE_GEOCODING_API_KEY;
  beforeEach(() => {
    process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY = 'test-key';
    delete process.env.GOOGLE_GEOCODING_API_KEY;
    vi.stubGlobal('fetch', vi.fn());
  });
  afterEach(() => {
    restoreEnv('NEXT_PUBLIC_GOOGLE_MAPS_API_KEY', OLD_PUBLIC);
    restoreEnv('GOOGLE_GEOCODING_API_KEY', OLD_SERVER);
    vi.unstubAllGlobals();
  });

  it('ritorna lat/lng dal primo risultato OK', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'OK', results: [{ geometry: { location: { lat: 45.4, lng: 9.1 } } }] }),
    });
    expect(await geocodeAddress(ADDR)).toEqual({ lat: 45.4, lng: 9.1 });
  });

  it('ritorna null su ZERO_RESULTS', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'ZERO_RESULTS', results: [] }),
    });
    expect(await geocodeAddress(ADDR)).toBeNull();
  });

  it('ritorna null su errore di rete', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('network'));
    expect(await geocodeAddress(ADDR)).toBeNull();
  });

  it('senza nessuna chiave ritorna null e non chiama fetch', async () => {
    delete process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
    delete process.env.GOOGLE_GEOCODING_API_KEY;
    expect(await geocodeAddress(ADDR)).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  // La chiave pubblica è referrer-restricted → inutilizzabile server-side. Le
  // chiamate server devono usare la chiave dedicata quando c'è.
  describe('scelta della chiave', () => {
    const okResponse = {
      ok: true,
      json: async () => ({ status: 'OK', results: [{ geometry: { location: { lat: 1, lng: 2 } } }] }),
    };

    it('usa GOOGLE_GEOCODING_API_KEY quando presente', async () => {
      process.env.GOOGLE_GEOCODING_API_KEY = 'server-key';
      mockedFetch().mockResolvedValue(okResponse);
      await geocodeAddress(ADDR);
      expect(String(mockedFetch().mock.calls[0][0])).toContain('key=server-key');
    });

    it('la chiave server ha la precedenza su quella pubblica', async () => {
      process.env.GOOGLE_GEOCODING_API_KEY = 'server-key';
      process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY = 'public-key';
      mockedFetch().mockResolvedValue(okResponse);
      await geocodeAddress(ADDR);
      const url = String(mockedFetch().mock.calls[0][0]);
      expect(url).toContain('key=server-key');
      expect(url).not.toContain('public-key');
    });

    it('ripiega sulla chiave pubblica se quella server manca', async () => {
      delete process.env.GOOGLE_GEOCODING_API_KEY;
      process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY = 'public-key';
      mockedFetch().mockResolvedValue(okResponse);
      await geocodeAddress(ADDR);
      expect(String(mockedFetch().mock.calls[0][0])).toContain('key=public-key');
    });
  });
});
