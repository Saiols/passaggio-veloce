import 'server-only';
import { prisma } from '@pv/db';
import { getStripe } from './stripe-client';
import type { ChargeFeeInput, ExecutePayoutInput, PaymentProvider, PaymentResult } from './types';

function isRetryableStripeError(err: unknown): boolean {
  const type = (err as { type?: string } | null)?.type;
  return (
    type === 'StripeConnectionError' ||
    type === 'StripeAPIError' ||
    type === 'StripeRateLimitError'
  );
}

export class StripePaymentProvider implements PaymentProvider {
  readonly name = 'stripe' as const;

  async chargeFee(input: ChargeFeeInput): Promise<PaymentResult> {
    if (input.importoCent <= 0) {
      return { ok: false, error: 'Importo non valido', retryable: false };
    }
    const agenzia = await prisma.company.findUnique({
      where: { id: input.agenziaId },
      select: { stripeCustomerId: true, stripePaymentMethodId: true, sepaMandateStatus: true },
    });
    if (
      !agenzia ||
      agenzia.sepaMandateStatus !== 'ACTIVE' ||
      !agenzia.stripeCustomerId ||
      !agenzia.stripePaymentMethodId
    ) {
      return { ok: false, error: 'Mandato SEPA non configurato', retryable: false };
    }
    try {
      const stripe = getStripe();
      const pi = await stripe.paymentIntents.create(
        {
          amount: input.importoCent,
          currency: 'eur',
          customer: agenzia.stripeCustomerId,
          payment_method: agenzia.stripePaymentMethodId,
          payment_method_types: ['sepa_debit'],
          off_session: true,
          confirm: true,
          metadata: { feeAddebitoId: input.feeAddebitoId },
        },
        { idempotencyKey: `charge-fee:${input.feeAddebitoId}` },
      );
      switch (pi.status) {
        case 'succeeded':
          return { ok: true, providerRef: pi.id };
        case 'processing':
          return { ok: true, providerRef: pi.id, pending: true };
        case 'requires_payment_method':
        case 'canceled':
          return { ok: false, error: `PaymentIntent stato ${pi.status}`, retryable: true };
        default:
          return { ok: false, error: `PaymentIntent stato ${pi.status}`, retryable: false };
      }
    } catch (e) {
      return { ok: false, error: (e as Error).message, retryable: isRetryableStripeError(e) };
    }
  }

  async executePayout(input: ExecutePayoutInput): Promise<PaymentResult> {
    if (input.importoCent <= 0) {
      return { ok: false, error: 'Importo non valido', retryable: false };
    }
    // Strada B: bonifico dal conto PV (fuori Stripe). No-op che registra il payout.
    // Al go-live sostituire con conferma admin o generazione file SEPA XML (pain.001).
    console.warn(
      `[stripe] payout Strada B no-op (bonifico manuale): payout=${input.payoutId} importo=${input.importoCent}c`,
    );
    return { ok: true, providerRef: `manual-bonifico:${input.payoutId}` };
  }
}
