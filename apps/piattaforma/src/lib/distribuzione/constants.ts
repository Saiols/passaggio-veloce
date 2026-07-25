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
 * Round convenzionale delle assegnazioni create a mano dall'admin
 * (`/admin/escalation`). Valore alto per non collidere con i round reali della
 * distribuzione, che partono da 1 e crescono di uno per batch notificato.
 *
 * Le pratiche accettate su un'assegnazione con questo round sono **escluse**
 * dalla media dei round (`lib/distribuzione/statistiche.ts`): un'assegnazione
 * manuale non dice nulla sulla velocità della distribuzione automatica.
 */
export const ESCALATION_ROUND = 99;
