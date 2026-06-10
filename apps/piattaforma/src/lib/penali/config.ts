/**
 * Costanti del Sistema Penali Broker (SP-A release 2026-05).
 * Spec: docs/sistema-penali-broker.md
 *
 * In una fase futura queste soglie diventeranno configurabili via UI admin
 * (Settings); per ora sono costanti runtime applicate uniformemente.
 */

export const PENALI = {
  /**
   * Importo penale addebitato al broker per ogni pratica annullata in seguito
   * a segnalazione confermata (fermo amministrativo / ipoteca / doc non
   * valido). In cent. €25 default (rif. docs/segnalazioni-penali.md, 2026-06-10).
   *
   * NB: la segnalazione è pre-firma, quindi il compenso €25 della pratica non è
   * ancora accreditato → il broker lo PERDE (non lo matura), non glielo si
   * storna dal wallet. Lo storno del compenso scatta solo nell'edge case in cui
   * il credito fosse già stato accreditato. Impatto complessivo broker: −€50
   * (€25 penale reale + €25 compenso non maturato).
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
   */
  POPUP_VERSION: 'v1.0',
} as const;
