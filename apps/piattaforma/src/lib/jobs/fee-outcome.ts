import type { PaymentResult } from '@/lib/providers/payment';

export type FeeOutcome =
  | { status: 'SUCCESS'; providerRef: string }
  | { status: 'PENDING'; providerRef: string }
  | { status: 'RETRY'; error: string }
  | { status: 'FAILED'; error: string };

/** Mappa l'esito del provider sullo stato del FeeAddebito.
 *  PENDING = SEPA in settlement: il fee resta IN_LAVORAZIONE, il webhook finalizza. */
export function feeOutcomeFromResult(result: PaymentResult): FeeOutcome {
  if (result.ok) {
    return result.pending
      ? { status: 'PENDING', providerRef: result.providerRef }
      : { status: 'SUCCESS', providerRef: result.providerRef };
  }
  return result.retryable
    ? { status: 'RETRY', error: result.error }
    : { status: 'FAILED', error: result.error };
}
