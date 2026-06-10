import 'server-only';
import { prisma } from '@pv/db';
import { getPayment } from '@/lib/providers/payment';
import { isPaymentLive } from './payment-live';
import { feeOutcomeFromResult } from './fee-outcome';

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

    const outcome = feeOutcomeFromResult(result);
    if (outcome.status === 'SUCCESS') {
      await prisma.feeAddebito.update({
        where: { id: fee.id },
        data: {
          stato: 'SUCCESS',
          providerRef: outcome.providerRef,
          executedAt: new Date(),
          errorMessage: null,
        },
      });
      succeeded++;
      // TODO: invia N8_AGENZIA_ADDEBITO — richiede query pratica+agenzia per payload
    } else if (outcome.status === 'PENDING') {
      // SEPA in settlement: resta IN_LAVORAZIONE, il webhook payment_intent.*
      // finalizzerà SUCCESS/FAILED. Salviamo solo il providerRef.
      await prisma.feeAddebito.update({
        where: { id: fee.id },
        data: { providerRef: outcome.providerRef },
      });
    } else {
      await prisma.feeAddebito.update({
        where: { id: fee.id },
        data: {
          stato: outcome.status,
          errorMessage: outcome.error,
          executedAt: new Date(),
        },
      });
      failed++;
    }
  }

  return { processed: fees.length, succeeded, failed };
}
