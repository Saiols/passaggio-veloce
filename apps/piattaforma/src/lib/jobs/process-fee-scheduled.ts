import 'server-only';
import { prisma } from '@pv/db';
import { isPaymentLive } from './payment-live';
import { processFeeAddebito } from '@/lib/fee/process';

const BATCH_SIZE = 30;
/** Fee rimaste IN_LAVORAZIONE senza providerRef più a lungo di questo ms
 *  non hanno mai creato un PaymentIntent Stripe: reset sicuro a SCHEDULED. */
const REAPER_THRESHOLD_MS = 15 * 60 * 1000; // 15 minuti

export type ProcessFeeResult = {
  processed: number;
  succeeded: number;
  failed: number;
};

export async function processFeeScheduled(): Promise<ProcessFeeResult> {
  if (!isPaymentLive()) {
    console.warn('[payment] processFeeScheduled sospeso: provider mock, in attesa di Stripe');
    return { processed: 0, succeeded: 0, failed: 0 };
  }

  // REAPER: fee bloccate IN_LAVORAZIONE senza providerRef da > 15 min.
  // Non hanno mai creato un PaymentIntent Stripe → reset a SCHEDULED sicuro.
  // SAFETY: non tocca fee con providerRef valorizzato (settlement SEPA legittimo).
  const reaperCutoff = new Date(Date.now() - REAPER_THRESHOLD_MS);
  const reaped = await prisma.feeAddebito.updateMany({
    where: {
      stato: 'IN_LAVORAZIONE',
      providerRef: null,
      updatedAt: { lt: reaperCutoff },
    },
    data: { stato: 'SCHEDULED', scheduledAt: new Date() },
  });
  if (reaped.count > 0) {
    console.warn(`[processFeeScheduled] reaper: ${reaped.count} fee IN_LAVORAZIONE senza providerRef reset a SCHEDULED`);
  }

  const now = new Date();
  const fees = await prisma.feeAddebito.findMany({
    where: { stato: 'SCHEDULED', scheduledAt: { lte: now } },
    take: BATCH_SIZE,
    orderBy: { scheduledAt: 'asc' },
  });

  let succeeded = 0;
  let failed = 0;

  for (const fee of fees) {
    const status = await processFeeAddebito(fee.id);
    if (status === 'SUCCESS') succeeded++;
    else if (status === 'RETRY' || status === 'FAILED') failed++;
  }

  return { processed: fees.length, succeeded, failed };
}
