import 'server-only';
import { prisma } from '@pv/db';
import { getPayment } from '@/lib/providers/payment';
import { feeOutcomeFromResult } from '@/lib/jobs/fee-outcome';
import { bloccaAgenziaPerAddebito, rivalutaBloccoAgenzia } from './blocco';

export type ProcessFeeStatus = 'SUCCESS' | 'PENDING' | 'RETRY' | 'FAILED' | 'SKIPPED';

/**
 * Processa un singolo FeeAddebito: IN_LAVORAZIONE → chargeFee → aggiorna stato
 * e aggancia il blocco/sblocco agenzia. Usato dal job batch e dal retry manuale.
 * Su FAILED/RETRY blocca l'agenzia; su SUCCESS rivaluta lo sblocco.
 */
export async function processFeeAddebito(feeId: string): Promise<ProcessFeeStatus> {
  const fee = await prisma.feeAddebito.findUnique({ where: { id: feeId } });
  if (!fee || fee.stato === 'SUCCESS' || fee.stato === 'ANNULLATO') return 'SKIPPED';

  await prisma.feeAddebito.update({ where: { id: feeId }, data: { stato: 'IN_LAVORAZIONE' } });

  const result = await getPayment().chargeFee({
    feeAddebitoId: fee.id,
    importoCent: fee.importoCent,
    agenziaId: fee.agenziaId,
    tentativo: fee.tentativi,
  });
  const outcome = feeOutcomeFromResult(result);

  if (outcome.status === 'SUCCESS') {
    await prisma.feeAddebito.update({
      where: { id: feeId },
      data: { stato: 'SUCCESS', providerRef: outcome.providerRef, executedAt: new Date(), errorMessage: null },
    });
    await rivalutaBloccoAgenzia(fee.agenziaId);
  } else if (outcome.status === 'PENDING') {
    await prisma.feeAddebito.update({ where: { id: feeId }, data: { providerRef: outcome.providerRef } });
    // resta IN_LAVORAZIONE: l'agenzia (se bloccata) resta bloccata fino al webhook
  } else {
    await prisma.feeAddebito.update({
      where: { id: feeId },
      data: { stato: outcome.status, errorMessage: outcome.error, executedAt: new Date() },
    });
    await bloccaAgenziaPerAddebito(feeId, outcome.error);
  }
  return outcome.status;
}
