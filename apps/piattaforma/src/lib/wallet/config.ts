/**
 * Soglie payout — fonte unica di verità.
 *
 * Decisione D-05 (soci 2026-05-01): broker e agenzie hanno le STESSE soglie.
 * - Forzato manuale: ≥ 500 € (l'utente può richiedere il payout).
 * - Automatico: ≥ 1.000 € (al raggiungimento parte un payout automatico).
 *
 * In futuro queste soglie potranno essere rese configurabili via tabella admin
 * (post-MVP). Per ora sono costanti applicate uniformemente a `Wallet`
 * indipendentemente dal `Company.type`.
 */

export const WALLET = {
  /** Saldo minimo per richiedere un payout manuale (cent). */
  MIN_PAYOUT_CENT: 50_000, // 500 €
  /** Soglia oltre la quale parte il payout automatico (cent). */
  AUTO_PAYOUT_THRESHOLD_CENT: 100_000, // 1.000 €
} as const;
