/**
 * Costanti del Sistema Penali Broker (SP-A release 2026-05).
 * Spec: docs/sistema-penali-broker.md
 *
 * In una fase futura queste soglie diventeranno configurabili via UI admin
 * (Settings); per ora sono costanti runtime applicate uniformemente.
 */

export const PENALI = {
  /**
   * Importo penale addebitato al broker per CIASCUN VEICOLO effettivamente
   * segnalato (mai per pratica intera, mai sui veicoli sani della stessa
   * pratica). In cent, €25 per veicolo (rif. docs/segnalazioni-penali.md,
   * aggiornato 2026-07-11 — clausola 10.4 dei Termini). Il totale per pratica
   * è `calcolaPenaleBrokerCent(veicoli)` qui sotto, non questa costante presa
   * da sola: pratica con 3 veicoli e 1 segnalato → penale €25, non €75.
   *
   * NB: la segnalazione è pre-firma, quindi il compenso della pratica non è
   * ancora accreditato → il broker lo PERDE (non lo matura), non glielo si
   * storna dal wallet. Lo storno del compenso scatta solo nell'edge case in cui
   * il credito fosse già stato eccezionalmente accreditato.
   */
  PENALE_BROKER_DEFAULT_CENT: 2_500,

  /**
   * Soglia ≥ N penali confermate dopo cui scatta l'alert agli admin per
   * valutare la sospensione dell'account broker.
   */
  MAX_PENALI_BEFORE_ALERT: 2,

  /**
   * Versione corrente del testo del popup di responsabilità. Cambiarla
   * quando si modifica il copy del popup, in modo che il log
   * BrokerDichiarazione preservi la traccia esatta del testo accettato.
   *
   * v2.0 (2026-07-11): la penale è €25 per ciascun VEICOLO SEGNALATO (non per
   * pratica) e non è soggetta a IVA — rimosso «lordi», che non corrispondeva
   * ad alcun calcolo. Vedi docs/superpowers/specs/2026-07-11-termini-penali-sospensione-design.md
   *
   * v3.0 (2026-07-14): aggiunta la conferma che il broker ha informato
   * venditore e acquirente del trattamento dei loro dati (clausola 17 dei
   * Termini) — rende azionabile la manleva della 17.5 registrando la
   * garanzia ad ogni invio pratica, non solo una volta in registrazione.
   * Vedi docs/superpowers/plans/2026-07-14-gdpr-dati-terzi.md
   */
  POPUP_VERSION: 'v3.0',
} as const;

/**
 * Penale broker per una pratica segnalata: €25 (PENALE_BROKER_DEFAULT_CENT) ×
 * numero di veicoli segnalati. Fallback a 1 veicolo per le segnalazioni legacy
 * create prima che il campo `Veicolo.segnalato` esistesse (mai 0: non
 * addebiteremmo nulla). Fonte unica della regola — usata sia dal server action
 * che la applica (`lib/penali/segnalazione.ts`) sia dalla UI admin che la deve
 * mostrare PRIMA di eseguirla (`/admin/segnalazioni`), per garantire che i due
 * numeri coincidano sempre.
 */
export function calcolaPenaleBrokerCent(veicoli: { segnalato: boolean }[]): number {
  const veicoliSegnalati = veicoli.filter((v) => v.segnalato).length;
  const nPenali = veicoliSegnalati > 0 ? veicoliSegnalati : 1;
  return PENALI.PENALE_BROKER_DEFAULT_CENT * nPenali;
}
