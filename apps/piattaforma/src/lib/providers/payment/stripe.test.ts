import { describe, it, expect, vi, beforeEach } from 'vitest';

const { paymentIntentsCreate, companyFindUnique } = vi.hoisted(() => ({
  paymentIntentsCreate: vi.fn(),
  companyFindUnique: vi.fn(),
}));

vi.mock('./stripe-client', () => ({
  getStripe: () => ({ paymentIntents: { create: paymentIntentsCreate } }),
}));
vi.mock('@pv/db', () => ({ prisma: { company: { findUnique: companyFindUnique } } }));

import { StripePaymentProvider } from './stripe';

const provider = new StripePaymentProvider();
const charge = { feeAddebitoId: 'fee-1', importoCent: 7500, agenziaId: 'ag-1' };
const activeAgency = {
  stripeCustomerId: 'cus_1',
  stripePaymentMethodId: 'pm_1',
  sepaMandateStatus: 'ACTIVE',
};

describe('StripePaymentProvider.chargeFee', () => {
  beforeEach(() => {
    paymentIntentsCreate.mockReset();
    companyFindUnique.mockReset();
  });

  it('processing → ok + pending', async () => {
    companyFindUnique.mockResolvedValue(activeAgency);
    paymentIntentsCreate.mockResolvedValue({ id: 'pi_1', status: 'processing' });
    const r = await provider.chargeFee(charge);
    expect(r).toEqual({ ok: true, providerRef: 'pi_1', pending: true });
  });

  it('succeeded → ok senza pending', async () => {
    companyFindUnique.mockResolvedValue(activeAgency);
    paymentIntentsCreate.mockResolvedValue({ id: 'pi_2', status: 'succeeded' });
    const r = await provider.chargeFee(charge);
    expect(r).toEqual({ ok: true, providerRef: 'pi_2' });
  });

  it('mandato non ACTIVE → ok:false non-retryable, niente chiamata Stripe', async () => {
    companyFindUnique.mockResolvedValue({ ...activeAgency, sepaMandateStatus: 'PENDING' });
    const r = await provider.chargeFee(charge);
    expect(r).toEqual({ ok: false, error: 'Mandato SEPA non configurato', retryable: false });
    expect(paymentIntentsCreate).not.toHaveBeenCalled();
  });

  it('errore Stripe → ok:false con retryable da tipo errore', async () => {
    companyFindUnique.mockResolvedValue(activeAgency);
    const err = Object.assign(new Error('rate limited'), { type: 'StripeRateLimitError' });
    paymentIntentsCreate.mockRejectedValue(err);
    const r = await provider.chargeFee(charge);
    expect(r).toEqual({ ok: false, error: 'rate limited', retryable: true });
  });

  it('importo non valido → ok:false non-retryable', async () => {
    const r = await provider.chargeFee({ ...charge, importoCent: 0 });
    expect(r).toEqual({ ok: false, error: 'Importo non valido', retryable: false });
  });
});

describe('StripePaymentProvider.executePayout', () => {
  it('Strada B no-op → ok con providerRef manual-bonifico', async () => {
    const r = await provider.executePayout({ payoutId: 'po-1', importoCent: 50000, iban: 'IT60X0542811101000000123456' });
    expect(r).toEqual({ ok: true, providerRef: 'manual-bonifico:po-1' });
  });

  it('importo non valido → ok:false non-retryable', async () => {
    const r = await provider.executePayout({ payoutId: 'po-x', importoCent: -1, iban: 'IT60' });
    expect(r).toEqual({ ok: false, error: 'Importo non valido', retryable: false });
  });
});
