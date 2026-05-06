import 'server-only';
import type { Prisma } from '@pv/db';
import { RANKING, ANTI_ABUSO } from './constants';
import {
  effectiveScore as _effectiveScore,
  rankCandidates as _rankCandidates,
} from './ranking-util';

export const effectiveScore = _effectiveScore;
export const rankCandidates = _rankCandidates;

export type AgenziaRanked = {
  id: string;
  createdAt: Date;
  ragioneSociale: string;
  provincia: string;
  ratingAvg: number | null;
  ratingCount: number;
  ranked: boolean; // count ≥ MIN_RATINGS_FOR_RANK
  sospesa: boolean; // ranked && avg < MIN_AVG_TO_STAY_ACTIVE
  /** A3: rifiuti consecutivi recenti (anti-abuso). Più alto = più penalità. */
  recentRejects: number;
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

  const candidateIds = candidate.map((c) => c.id);

  const [ratings, recentAssegnazioni] = await Promise.all([
    tx.valutazione.groupBy({
      by: ['agenziaId'],
      where: { agenziaId: { in: candidateIds } },
      _avg: { stelle: true },
      _count: { _all: true },
    }),
    // A3: ultime N assegnazioni per agenzia, ordinate desc per timestamp,
    // per calcolare i "rifiuti consecutivi" recenti (decay anti-abuso).
    tx.praticaAssegnazione.findMany({
      where: {
        agenziaId: { in: candidateIds },
        esito: { in: ['ACCETTATA', 'RIFIUTATA', 'TIMEOUT'] },
      },
      orderBy: { esitoAt: 'desc' },
      select: { agenziaId: true, esito: true },
      take: ANTI_ABUSO.REJECT_DECAY_LOOKBACK * candidateIds.length,
    }),
  ]);

  const byId = new Map<string, { avg: number | null; count: number }>();
  for (const r of ratings) {
    byId.set(r.agenziaId, { avg: r._avg.stelle, count: r._count._all });
  }

  // Per ogni agenzia: conta rifiuti consecutivi più recenti (RIFIUTATA),
  // si interrompono al primo ACCETTATA o TIMEOUT.
  const rejectsById = new Map<string, number>();
  for (const id of candidateIds) {
    const recent = recentAssegnazioni
      .filter((a) => a.agenziaId === id)
      .slice(0, ANTI_ABUSO.REJECT_DECAY_LOOKBACK);
    let consecutive = 0;
    for (const a of recent) {
      if (a.esito === 'RIFIUTATA') consecutive++;
      else break;
    }
    rejectsById.set(id, consecutive);
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
      recentRejects: rejectsById.get(c.id) ?? 0,
    };
  });
}

