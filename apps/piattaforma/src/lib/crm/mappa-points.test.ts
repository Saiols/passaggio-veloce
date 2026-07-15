import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: { sede: { findMany: vi.fn(), count: vi.fn() } },
}));
vi.mock('@pv/db', () => ({ prisma: prismaMock }));

import { getMappaPoints } from './mappa-points';

beforeEach(() => vi.clearAllMocks());

describe('getMappaPoints', () => {
  it('mappa le sedi geocodate in punti e conta le non geolocalizzate', async () => {
    prismaMock.sede.findMany.mockResolvedValue([
      { id: 's-1', type: 'DEALER', lat: 45.4, lng: 9.1, nome: 'HQ', citta: 'Milano', provincia: 'MI' },
      { id: 's-2', type: 'AGENZIA', lat: 41.9, lng: 12.5, nome: 'Roma', citta: 'Roma', provincia: 'RM' },
    ]);
    prismaMock.sede.count.mockResolvedValue(3);

    const res = await getMappaPoints();

    expect(res.points).toHaveLength(2);
    expect(res.points[0]).toEqual({
      id: 's-1', type: 'DEALER', lat: 45.4, lng: 9.1, nome: 'HQ', citta: 'Milano', provincia: 'MI',
    });
    expect(res.nonGeolocalizzate).toBe(3);
  });

  it('filtra su sedi non cancellate, con coordinate, di aziende non cancellate', async () => {
    prismaMock.sede.findMany.mockResolvedValue([]);
    prismaMock.sede.count.mockResolvedValue(0);
    await getMappaPoints();
    const where = prismaMock.sede.findMany.mock.calls[0][0].where;
    expect(where.deletedAt).toBeNull();
    expect(where.lat).toEqual({ not: null });
    expect(where.lng).toEqual({ not: null });
    expect(where.company).toEqual({ deletedAt: null });

    const countWhere = prismaMock.sede.count.mock.calls[0][0].where;
    expect(countWhere.deletedAt).toBeNull();
    expect(countWhere.lat).toBeNull();
    expect(countWhere.company).toEqual({ deletedAt: null });
  });
});
