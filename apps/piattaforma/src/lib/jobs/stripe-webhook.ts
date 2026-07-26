import 'server-only';
import { prisma } from '@pv/db';
import type Stripe from 'stripe';
import { bloccaAgenziaPerAddebito } from '@/lib/fee/blocco';
import { segnaFeeIncassato } from '@/lib/fee/incasso';
import { ritentaAddebitiAgenzia } from '@/lib/fee/retry';

/** Routing idempotente degli eventi Stripe rilevanti. Fonte di verità per il
 *  settlement SEPA asincrono e per lo stato del mandato. */
export async function handleStripeEvent(event: Stripe.Event): Promise<void> {
  switch (event.type) {
    case 'payment_intent.succeeded': {
      const pi = event.data.object as Stripe.PaymentIntent;
      const feeId = pi.metadata?.feeAddebitoId;
      if (feeId) {
        const vinto = await segnaFeeIncassato(feeId, pi.id);
        if (!vinto) {
          console.warn(`[stripe-webhook] succeeded: nessun FeeAddebito aggiornato (id=${feeId}, pi=${pi.id})`);
        }
      } else {
        console.warn(`[stripe-webhook] payment_intent.succeeded senza metadata.feeAddebitoId (pi=${pi.id})`);
      }
      break;
    }
    case 'payment_intent.payment_failed': {
      const pi = event.data.object as Stripe.PaymentIntent;
      const feeId = pi.metadata?.feeAddebitoId;
      if (feeId) {
        const r = await prisma.feeAddebito.updateMany({
          where: { id: feeId, stato: { notIn: ['SUCCESS', 'FAILED'] } },
          data: { stato: 'FAILED', errorMessage: pi.last_payment_error?.message ?? 'SEPA payment failed' },
        });
        if (r.count > 0) {
          await bloccaAgenziaPerAddebito(feeId, pi.last_payment_error?.message ?? 'SEPA payment failed');
        } else {
          console.warn(`[stripe-webhook] payment_failed: nessun FeeAddebito aggiornato (id=${feeId}, pi=${pi.id})`);
        }
      } else {
        console.warn(`[stripe-webhook] payment_intent.payment_failed senza metadata.feeAddebitoId (pi=${pi.id})`);
      }
      break;
    }
    case 'setup_intent.succeeded': {
      const si = event.data.object as Stripe.SetupIntent;
      const companyId = si.metadata?.companyId;
      if (companyId) {
        await prisma.company.updateMany({
          where: { id: companyId },
          data: { sepaMandateStatus: 'ACTIVE' },
        });
        // Best-effort: quando il mandato diventa ACTIVE, rilanciamo qualsiasi fee
        // FAILED/RETRY outstanding — indipendentemente dallo stato di blocco.
        // Se non ci sono fee pendenti è un no-op. Sicuro: ritentaAddebitiAgenzia
        // tocca solo fee in stato FAILED/RETRY.
        try {
          await ritentaAddebitiAgenzia(companyId);
        } catch {
          // best-effort: non propagare
        }
      }
      break;
    }
    case 'setup_intent.setup_failed': {
      const si = event.data.object as Stripe.SetupIntent;
      const companyId = si.metadata?.companyId;
      if (companyId) {
        await prisma.company.updateMany({
          where: { id: companyId },
          data: { sepaMandateStatus: 'FAILED' },
        });
      }
      break;
    }
    default:
      // Evento non rilevante: ack senza azione.
      break;
  }
}
