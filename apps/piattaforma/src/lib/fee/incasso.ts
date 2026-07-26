import 'server-only';
import { prisma } from '@pv/db';
import { rivalutaBloccoAgenzia } from './blocco';
import { createFatturaPv } from '@/lib/fatturazione/engine';

/**
 * UNICO punto in cui un FeeAddebito diventa SUCCESS.
 *
 * Prima esistevano due percorsi che scrivevano lo stesso stato e chiamavano lo
 * stesso `rivalutaBloccoAgenzia` in copia: l'esito sincrono di `chargeFee`
 * (process.ts) e il webhook `payment_intent.succeeded` per il settlement SEPA
 * asincrono (stripe-webhook.ts). Appendere l'emissione della fattura a
 * entrambi significava garantire che il prossimo intervento la dimenticasse in
 * uno dei due.
 *
 * Il compare-and-set NON è un dettaglio di concorrenza: è ciò che impedisce la
 * doppia fattura. Stripe può consegnare lo stesso evento più volte, e l'esito
 * sincrono può correre contro il webhook. Emette solo chi vince l'UPDATE.
 *
 * `ANNULLATO` resta escluso: un webhook in ritardo su un fee annullato non
 * deve resuscitarlo, tanto meno fatturarlo.
 *
 * Ritorna `true` se questa chiamata ha vinto (e quindi ha fatto tutto il resto).
 */
export async function segnaFeeIncassato(feeId: string, providerRef: string): Promise<boolean> {
  const claim = await prisma.feeAddebito.updateMany({
    where: { id: feeId, stato: { notIn: ['SUCCESS', 'ANNULLATO'] } },
    data: { stato: 'SUCCESS', providerRef, executedAt: new Date(), errorMessage: null },
  });
  if (claim.count === 0) return false;

  const fee = await prisma.feeAddebito.findUnique({
    where: { id: feeId },
    select: { agenziaId: true },
  });
  if (fee) await rivalutaBloccoAgenzia(fee.agenziaId);

  // I soldi sono arrivati: qualunque cosa vada storta nell'emissione, il fee
  // resta SUCCESS. La riconciliazione oraria recupera il documento mancante.
  await createFatturaPv({ feeAddebitoId: feeId, statoPagamento: 'PAGATA' }).catch(() => null);

  return true;
}
