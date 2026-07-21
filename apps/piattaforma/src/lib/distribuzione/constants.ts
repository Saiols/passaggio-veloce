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
