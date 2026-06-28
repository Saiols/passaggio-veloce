import 'server-only';
import { prisma } from '@pv/db';
import { isPaymentLive } from './payment-live';
import { processFeeAddebito } from '@/lib/fee/process';

const BATCH_SIZE = 30;

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
