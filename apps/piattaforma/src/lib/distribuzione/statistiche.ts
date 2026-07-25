import { prisma } from '@pv/db';

/** Ultimo bucket dell'istogramma: tutti i round da qui in su sono aggregati. */
export const ROUND_BUCKET_MAX = 5;

export type StatisticheRound = {
  /** Media aritmetica dei round di accettazione. `null` se il campione è vuoto. */
  media: number | null;
  /** Quante pratiche compongono il campione. */
  campione: number;
  /**
   * Istogramma ordinato per round crescente. L'ultima voce ha
   * `round = ROUND_BUCKET_MAX` e raccoglie anche tutti i round successivi
   * (etichetta "5+" nella UI).
   */
  perRound: { round: number; count: number }[];
};

/**
 * Media dei round di accettazione: dice entro quanto tempo le pratiche vengono
 * prese, perché il round avanza solo su un batch di notifiche reale
 * (`round N ≈ (N-1) × durata round`).
 *
 * Campione: pratiche non cancellate con `roundAccettazione` valorizzato. Ne
 * restano fuori, senza bisogno di filtri espliciti:
 *  - le pratiche mai accettate (colonna `null`);
 *  - quelle accettate prima di questa feature (nessun backfill, `null`);
 *  - le assegnazioni manuali da `/admin/escalation`, che portano la pratica in
 *    ACCETTATA senza passare dalla distribuzione e quindi non scrivono il
 *    round — una pratica piazzata a mano non dice nulla sulla velocità del
 *    motore.
 *
 * Nessun filtro sullo stato: una pratica accettata e poi firmata o processata
 * resta nel campione (il round in cui fu accettata non cambia). Nessun filtro
 * temporale: il campione è piccolo e serve tutto.
 */
export async function getStatisticheRound(): Promise<StatisticheRound> {
  const righe = await prisma.pratica.groupBy({
    by: ['roundAccettazione'],
    where: { deletedAt: null, roundAccettazione: { not: null } },
    _count: { _all: true },
  });

  let campione = 0;
  let somma = 0;
  const bucket = new Map<number, number>();

  for (const r of righe) {
    // `by` su una colonna nullable tipizza il valore come `number | null`
    // anche col filtro `not: null` nel where.
    if (r.roundAccettazione == null) continue;
    const count = r._count._all;
    campione += count;
    somma += r.roundAccettazione * count;
    const key = Math.min(r.roundAccettazione, ROUND_BUCKET_MAX);
    bucket.set(key, (bucket.get(key) ?? 0) + count);
  }

  const perRound = [...bucket.entries()]
    .map(([round, count]) => ({ round, count }))
    .sort((a, b) => a.round - b.round);

  return {
    media: campione > 0 ? somma / campione : null,
    campione,
    perRound,
  };
}
