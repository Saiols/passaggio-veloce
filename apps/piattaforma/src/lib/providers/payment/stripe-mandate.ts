import 'server-only';
import { prisma } from '@pv/db';
import { getStripe } from './stripe-client';

export type SetupSepaMandateInput = {
  companyId: string;
  iban: string;
  name: string;
  email: string;
  ip?: string | null;
  userAgent?: string | null;
};

export type SetupSepaMandateResult =
  | { ok: true; customerId: string; paymentMethodId: string; mandateId: string | null; status: string }
  | { ok: false; error: string };

/** Crea Customer + mandato SEPA Direct Debit (server-side). Non scrive sul DB. */
export async function setupSepaMandate(input: SetupSepaMandateInput): Promise<SetupSepaMandateResult> {
  try {
    const stripe = getStripe();
    const customer = await stripe.customers.create(
      { name: input.name, email: input.email, metadata: { companyId: input.companyId } },
      { idempotencyKey: `setup-mandate-customer:${input.companyId}` },
    );
    const setupIntent = await stripe.setupIntents.create({
      customer: customer.id,
      payment_method_types: ['sepa_debit'],
      payment_method_data: {
        type: 'sepa_debit',
        sepa_debit: { iban: input.iban },
        billing_details: { name: input.name, email: input.email },
      },
      mandate_data: {
        customer_acceptance: {
          type: 'online',
          online: {
            ip_address: input.ip ?? '0.0.0.0',
            user_agent: input.userAgent ?? 'unknown',
          },
        },
      },
      confirm: true,
      metadata: { companyId: input.companyId },
    });
    const paymentMethodId =
      typeof setupIntent.payment_method === 'string'
        ? setupIntent.payment_method
        : (setupIntent.payment_method?.id ?? null);
    if (!paymentMethodId) {
      return { ok: false, error: 'PaymentMethod non creato dal SetupIntent' };
    }
    const mandateId =
      typeof setupIntent.mandate === 'string' ? setupIntent.mandate : (setupIntent.mandate?.id ?? null);
    return { ok: true, customerId: customer.id, paymentMethodId, mandateId, status: setupIntent.status };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export type ApplySepaMandateStatus = 'ACTIVE' | 'PENDING' | 'FAILED';

/** Setup mandato + persistenza su Company. Best-effort dal flusso registrazione (AGENZIA).
 *  ACTIVE solo se il SetupIntent è `succeeded`: se SEPA resta `processing` segniamo
 *  PENDING e lasciamo che il webhook `setup_intent.succeeded/setup_failed` riconcili,
 *  così non si addebita su un mandato non ancora confermato. */
export async function applySepaMandateToAgency(
  input: SetupSepaMandateInput,
): Promise<ApplySepaMandateStatus> {
  const r = await setupSepaMandate(input);
  if (r.ok) {
    const status: ApplySepaMandateStatus = r.status === 'succeeded' ? 'ACTIVE' : 'PENDING';
    await prisma.company.update({
      where: { id: input.companyId },
      data: {
        stripeCustomerId: r.customerId,
        stripePaymentMethodId: r.paymentMethodId,
        sepaMandateId: r.mandateId,
        sepaMandateStatus: status,
      },
    });
    return status;
  }
  await prisma.company.update({
    where: { id: input.companyId },
    data: { sepaMandateStatus: 'FAILED' },
  });
  return 'FAILED';
}
