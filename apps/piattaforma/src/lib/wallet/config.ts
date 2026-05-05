/**
 * Soglie payout — default e range.
 *
 * - Decisione D-05 (soci 2026-05-01): broker e agenzie hanno gli STESSI default.
 * - Item 12 release 2026-05: la soglia auto-payout e' configurabile per
 *   utente (Company.payoutThresholdCent) entro il range qui sotto. La soglia
 *   minima per richiesta manuale resta una costante globale.
 */

export const WALLET = {
  /** Saldo minimo per richiedere un payout manuale (cent). */
  MIN_PAYOUT_CENT: 50_000, // 500 €
  /** Default per Company.payoutThresholdCent (cent). */
  AUTO_PAYOUT_DEFAULT_CENT: 100_000, // 1.000 €
  /** Range configurabile della soglia auto-payout (cent). */
  AUTO_PAYOUT_MIN_CENT: 100_000, // 1.000 €
  AUTO_PAYOUT_MAX_CENT: 500_000, // 5.000 €
} as const;

/**
 * Valida e clamp il valore dato della soglia auto-payout (in cent) entro
 * il range consentito. Ritorna null se il valore non e' un intero valido.
 */
export function validatePayoutThresholdCent(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n)) return null;
  if (n < WALLET.AUTO_PAYOUT_MIN_CENT) return null;
  if (n > WALLET.AUTO_PAYOUT_MAX_CENT) return null;
  return n;
}
