/**
 * Parametri distribuzione pratica — da `docs/piano-implementazione.md §0.5`.
 * Sostituibili via DB admin config in Fase 9.
 */
export const DISTRIBUZIONE = {
  T1_HOURS: 8, // finestra round 1 — ore lavorative dell'agenzia
  T2_HOURS: 8, // finestra round 2
  T3_HOURS: 16, // finestra round 3
  N_PER_ROUND: 5, // agenzie per round 1 e 2
  N_MAX: 15, // cap totale su round 3
} as const;

/**
 * Soglie ranking agenzie.
 * - `MIN_RATINGS_FOR_RANK`: numero minimo di valutazioni perché il rating
 *   sia considerato affidabile (sotto, l'agenzia è "non rankata" — neutra)
 * - `LOW_RATING_THRESHOLD`: media (per le agenzie rankate) sotto cui l'agenzia
 *   viene EVIDENZIATA all'admin come "rating basso". È solo una segnalazione
 *   visiva (così l'admin può contattarla): NESSUN effetto operativo — l'agenzia
 *   NON viene sospesa e resta regolarmente nella distribuzione.
 */
export const RANKING = {
  MIN_RATINGS_FOR_RANK: 5,
  LOW_RATING_THRESHOLD: 2.5,
} as const;

/**
 * Anti-abuso ranking (A3).
 * - `REJECT_DECAY_PER_REJECT`: penalità (in stelle) sottratta dallo score
 *   ordering per ogni rifiuto consecutivo recente. Es. 3 rifiuti consecutivi
 *   → ratingAvg effettivo ridotto di 0.6 nel sort.
 * - `REJECT_DECAY_LOOKBACK`: numero massimo di assegnazioni recenti
 *   considerate per il calcolo dei "rifiuti consecutivi".
 * - `AUTO_SUSPEND_TIMEOUT_THRESHOLD`: dopo N TIMEOUT consecutivi (no-show),
 *   l'agenzia viene sospesa automaticamente con motivo audit.
 */
export const ANTI_ABUSO = {
  REJECT_DECAY_PER_REJECT: 0.2,
  REJECT_DECAY_LOOKBACK: 10,
  AUTO_SUSPEND_TIMEOUT_THRESHOLD: 5,
} as const;
