/**
 * Parametri distribuzione pratica — da `docs/piano-implementazione.md §0.5`.
 * Sostituibili via DB admin config in Fase 9.
 */
export const DISTRIBUZIONE = {
  RAGGI_KM: [0.5, 0.75, 1], // round 1/2/3 = 500/750/1000 m
  T1_HOURS: 4,
  T2_HOURS: 4,
  T3_HOURS: 4,
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
 * Anti-abuso distribuzione (A3).
 * - `AUTO_SUSPEND_TIMEOUT_THRESHOLD`: dopo N TIMEOUT consecutivi (no-show),
 *   l'agenzia viene sospesa automaticamente con motivo audit.
 */
export const ANTI_ABUSO = {
  AUTO_SUSPEND_TIMEOUT_THRESHOLD: 5,
} as const;
