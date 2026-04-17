import 'server-only';
import type { Prisma } from '@pv/db';
import { RANKING } from './constants';

export type AgenziaRanked = {
  id: string;
  createdAt: Date;
  ragioneSociale: string;
  provincia: string;
  ratingAvg: number | null;
  ratingCount: number;
  ranked: boolean; // count ≥ MIN_RATINGS_FOR_RANK
  sospesa: boolean; // ranked && avg < MIN_AVG_TO_STAY_ACTIVE
};

type Candidate = {
  id: string;
  createdAt: Date;
  ragioneSociale: string;
  provincia: string;
};

/**
 * Attacca rating aggregato a una lista di candidate agenzie e marca lo stato
 * (ranked / sospesa). Non mutua l'input.
 */
export async function attachRating(
  tx: Prisma.TransactionClient,
  candidate: readonly Candidate[],
): Promise<AgenziaRanked[]> {
  if (candidate.length === 0) return [];

  const ratings = await tx.valutazione.groupBy({
    by: ['agenziaId'],
    where: { agenziaId: { in: candidate.map((c) => c.id) } },
    _avg: { stelle: true },
    _count: { _all: true },
  });

  const byId = new Map<string, { avg: number | null; count: number }>();
  for (const r of ratings) {
    byId.set(r.agenziaId, { avg: r._avg.stelle, count: r._count._all });
  }

  return candidate.map((c) => {
    const entry = byId.get(c.id);
    const ratingAvg = entry?.avg ?? null;
    const ratingCount = entry?.count ?? 0;
    const ranked = ratingCount >= RANKING.MIN_RATINGS_FOR_RANK;
    const sospesa = ranked && (ratingAvg ?? 0) < RANKING.MIN_AVG_TO_STAY_ACTIVE;
    return {
      ...c,
      ratingAvg,
      ratingCount,
      ranked,
      sospesa,
    };
  });
}

/**
 * Filtra e ordina candidate per la distribuzione:
 *   1. Esclude le sospese (ranked + avg < soglia)
 *   2. Ordina: rankate (avg desc) prima, non rankate dopo (tie-break createdAt asc)
 */
export function rankCandidates(agenzie: AgenziaRanked[]): AgenziaRanked[] {
  const eligible = agenzie.filter((a) => !a.sospesa);
  eligible.sort((a, b) => {
    if (a.ranked && b.ranked) {
      return (b.ratingAvg ?? 0) - (a.ratingAvg ?? 0);
    }
    if (a.ranked) return -1;
    if (b.ranked) return 1;
    return a.createdAt.getTime() - b.createdAt.getTime();
  });
  return eligible;
}
