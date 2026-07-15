import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));

const { prismaMock, geocodeMock } = vi.hoisted(() => ({
  prismaMock: { sede: { findMany: vi.fn(), update: vi.fn() } },
  geocodeMock: vi.fn(),
}));

vi.mock('@pv/db', () => ({ prisma: prismaMock }));
vi.mock('./geocode', () => ({ geocodeAddress: geocodeMock }));

import { geocodeCompanySedi } from './geocode-sedi';

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.sede.update.mockResolvedValue({});
});

describe('geocodeCompanySedi', () => {
  it('geocoda e aggiorna solo le sedi con coordinate ottenute', async () => {
    prismaMock.sede.findMany.mockResolvedValue([
      { id: 's-1', indirizzo: 'Via A', civico: '1', citta: 'Roma', cap: '00100', provincia: 'RM' },
      { id: 's-2', indirizzo: 'Via B', civico: null, citta: 'X', cap: '00000', provincia: 'ZZ' },
    ]);
    geocodeMock.mockResolvedValueOnce({ lat: 41.9, lng: 12.5 }).mockResolvedValueOnce(null);

    await geocodeCompanySedi('c-1');

    expect(prismaMock.sede.update).toHaveBeenCalledTimes(1);
    const call = prismaMock.sede.update.mock.calls[0][0];
    expect(call.where).toEqual({ id: 's-1' });
    expect(call.data.lat).toBe(41.9);
    expect(call.data.geocodedAt).toBeInstanceOf(Date);
  });

  it('non lancia se il DB va in errore', async () => {
    prismaMock.sede.findMany.mockRejectedValue(new Error('db'));
    await expect(geocodeCompanySedi('c-1')).resolves.toBeUndefined();
  });
});
