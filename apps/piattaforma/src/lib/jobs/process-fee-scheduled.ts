import 'server-only';
import { prisma } from '@pv/db';
import { getPayment } from '@/lib/providers/payment';
import { isPaymentLive } from './payment-live';

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
  const payment = getPayment();

  for (const fee of fees) {
    await prisma.feeAddebito.update({
      where: { id: fee.id },
      data: { stato: 'IN_LAVORAZIONE' },
    });

    const result = await payment.chargeFee({
      feeAddebitoId: fee.id,
      importoCent: fee.importoCent,
      agenziaId: fee.agenziaId,
    });

    if (result.ok) {
      await prisma.feeAddebito.update({
        where: { id: fee.id },
        data: {
          stato: 'SUCCESS',
          providerRef: result.providerRef,
          executedAt: new Date(),
          errorMessage: null,
        },
      });
      succeeded++;
      // TODO: invia N8_AGENZIA_ADDEBITO — richiede query pratica+agenzia per payload
    } else {
      await prisma.feeAddebito.update({
        where: { id: fee.id },
        data: {
          stato: result.retryable ? 'RETRY' : 'FAILED',
          errorMessage: result.error,
          executedAt: new Date(),
        },
      });
      failed++;
    }
  }

  return { processed: fees.length, succeeded, failed };
}
