/**
 * Helper puri di ranking — niente import server-only, testabili senza prisma.
 * Riusati da ranking.ts (server-only) per la logica di ordering.
 */
import { ANTI_ABUSO } from './constants';

export type AgenziaRankedLike = {
  id: string;
  createdAt: Date;
  ratingAvg: number | null;
  ratingCount: number;
  ranked: boolean;
  sospesa: boolean;
  recentRejects: number;
};

/**
 * Score effettivo per il sort, con decay anti-abuso per rifiuti consecutivi.
 */
export function effectiveScore(a: {
  ratingAvg: number | null;
  recentRejects: number;
}): number {
  return (
    (a.ratingAvg ?? 0) -
    a.recentRejects * ANTI_ABUSO.REJECT_DECAY_PER_REJECT
  );
}

/**
 * Filtra e ordina candidate per la distribuzione:
 *   1. Esclude le sospese (ranked + avg < soglia)
 *   2. Ordina: rankate (effectiveScore desc) prima, non rankate dopo
 *      (tie-break createdAt asc). effectiveScore = ratingAvg − decay rifiuti.
 */
export function rankCandidates<T extends AgenziaRankedLike>(agenzie: T[]): T[] {
  const eligible = agenzie.filter((a) => !a.sospesa);
  eligible.sort((a, b) => {
    if (a.ranked && b.ranked) {
      return effectiveScore(b) - effectiveScore(a);
    }
    if (a.ranked) return -1;
    if (b.ranked) return 1;
    return (
      a.recentRejects - b.recentRejects ||
      a.createdAt.getTime() - b.createdAt.getTime()
    );
  });
  return eligible;
}
