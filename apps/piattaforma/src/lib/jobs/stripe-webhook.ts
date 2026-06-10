import 'server-only';
import { prisma } from '@pv/db';
import type Stripe from 'stripe';

/** Routing idempotente degli eventi Stripe rilevanti. Fonte di verità per il
 *  settlement SEPA asincrono e per lo stato del mandato. */
export async function handleStripeEvent(event: Stripe.Event): Promise<void> {
  switch (event.type) {
    case 'payment_intent.succeeded': {
      const pi = event.data.object as Stripe.PaymentIntent;
      const feeId = pi.metadata?.feeAddebitoId;
      if (feeId) {
        await prisma.feeAddebito.updateMany({
          where: { id: feeId, stato: { not: 'SUCCESS' } },
          data: { stato: 'SUCCESS', providerRef: pi.id, executedAt: new Date(), errorMessage: null },
        });
      }
      break;
    }
    case 'payment_intent.payment_failed': {
      const pi = event.data.object as Stripe.PaymentIntent;
      const feeId = pi.metadata?.feeAddebitoId;
      if (feeId) {
        await prisma.feeAddebito.updateMany({
          where: { id: feeId, stato: { notIn: ['SUCCESS', 'FAILED'] } },
          data: { stato: 'FAILED', errorMessage: pi.last_payment_error?.message ?? 'SEPA payment failed' },
        });
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
