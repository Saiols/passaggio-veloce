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
 * Ordina le candidate per la distribuzione: rankate (effectiveScore desc) prima,
 * non rankate dopo (tie-break createdAt asc). effectiveScore = ratingAvg − decay
 * rifiuti. NB: il rating basso NON esclude più dalla distribuzione (resta solo
 * un'evidenza per l'admin); un rating scarso fa comunque scivolare in coda.
 */
export function rankCandidates<T extends AgenziaRankedLike>(agenzie: T[]): T[] {
  const sorted = [...agenzie];
  sorted.sort((a, b) => {
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
  return sorted;
}
