import { describe, it, expect, vi, beforeEach } from 'vitest';

const groupByMock = vi.hoisted(() => vi.fn());
vi.mock('@pv/db', () => ({ prisma: { pratica: { groupBy: groupByMock } } }));

import { getStatisticheRound, ROUND_BUCKET_MAX } from './statistiche';

/** Forma della riga restituita da `groupBy` su `roundAccettazione`. */
function riga(roundAccettazione: number | null, count: number) {
  return { roundAccettazione, _count: { _all: count } };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('getStatisticheRound', () => {
  it('campione vuoto → media null, nessun bucket', async () => {
    groupByMock.mockResolvedValue([]);

    expect(await getStatisticheRound()).toEqual({ media: null, campione: 0, perRound: [] });
  });

  it('media pesata sui conteggi, non sui round distinti', async () => {
    // 9 pratiche al round 1 e 1 al round 5: la media è 1,4, non 3.
    groupByMock.mockResolvedValue([riga(1, 9), riga(5, 1)]);

    const stats = await getStatisticheRound();

    expect(stats.campione).toBe(10);
    expect(stats.media).toBeCloseTo(1.4, 5);
  });

  it('istogramma ordinato per round crescente', async () => {
    groupByMock.mockResolvedValue([riga(3, 1), riga(1, 4), riga(2, 2)]);

    const stats = await getStatisticheRound();

    expect(stats.perRound).toEqual([
      { round: 1, count: 4 },
      { round: 2, count: 2 },
      { round: 3, count: 1 },
    ]);
  });

  it('i round oltre la soglia confluiscono nel bucket "5+", ma la media usa il valore reale', async () => {
    groupByMock.mockResolvedValue([riga(5, 1), riga(7, 1), riga(12, 1)]);

    const stats = await getStatisticheRound();

    expect(stats.perRound).toEqual([{ round: ROUND_BUCKET_MAX, count: 3 }]);
    // (5+7+12)/3 = 8: se il bucket avesse schiacciato i valori sarebbe stata 5.
    expect(stats.media).toBeCloseTo(8, 5);
  });

  it('il campione esclude a monte le pratiche cancellate e senza round', async () => {
    groupByMock.mockResolvedValue([riga(1, 1)]);

    await getStatisticheRound();

    expect(groupByMock).toHaveBeenCalledWith(
      expect.objectContaining({
        by: ['roundAccettazione'],
        where: { deletedAt: null, roundAccettazione: { not: null } },
      }),
    );
  });

  // `by` su colonna nullable tipizza il valore come `number | null`: una riga
  // null non deve mai entrare nella somma (falserebbe la media a zero).
  it('una riga con round null viene ignorata anche se il DB la restituisse', async () => {
    groupByMock.mockResolvedValue([riga(2, 2), riga(null, 99)]);

    const stats = await getStatisticheRound();

    expect(stats.campione).toBe(2);
    expect(stats.media).toBe(2);
    expect(stats.perRound).toEqual([{ round: 2, count: 2 }]);
  });
});
