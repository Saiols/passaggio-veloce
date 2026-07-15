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

describe('geocodeAddress', () => {
  const OLD = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  beforeEach(() => {
    process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY = 'test-key';
    vi.stubGlobal('fetch', vi.fn());
  });
  afterEach(() => {
    process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY = OLD;
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

  it('senza chiave ritorna null e non chiama fetch', async () => {
    delete process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
    expect(await geocodeAddress(ADDR)).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });
});
