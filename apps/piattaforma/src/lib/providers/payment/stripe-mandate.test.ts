import { describe, it, expect, vi, beforeEach } from 'vitest';

const { customersCreate, setupIntentsCreate, companyUpdate } = vi.hoisted(() => ({
  customersCreate: vi.fn(),
  setupIntentsCreate: vi.fn(),
  companyUpdate: vi.fn(),
}));

vi.mock('./stripe-client', () => ({
  getStripe: () => ({
    customers: { create: customersCreate },
    setupIntents: { create: setupIntentsCreate },
  }),
}));
vi.mock('@pv/db', () => ({ prisma: { company: { update: companyUpdate } } }));

import { setupSepaMandate, applySepaMandateToAgency } from './stripe-mandate';

const input = {
  companyId: 'co-1',
  iban: 'IT60X0542811101000000123456',
  name: 'Agenzia X',
  email: 'a@x.it',
  ip: '1.2.3.0',
  userAgent: 'jest',
};

describe('setupSepaMandate', () => {
  beforeEach(() => {
    customersCreate.mockReset();
    setupIntentsCreate.mockReset();
  });

  it('crea customer + SetupIntent SEPA e ritorna gli id', async () => {
    customersCreate.mockResolvedValue({ id: 'cus_1' });
    setupIntentsCreate.mockResolvedValue({
      id: 'seti_1',
      payment_method: 'pm_1',
      mandate: 'mandate_1',
      status: 'succeeded',
    });

    const r = await setupSepaMandate(input);

    expect(r).toEqual({ ok: true, customerId: 'cus_1', paymentMethodId: 'pm_1', mandateId: 'mandate_1' });
    expect(setupIntentsCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        customer: 'cus_1',
        payment_method_types: ['sepa_debit'],
        confirm: true,
        payment_method_data: expect.objectContaining({
          type: 'sepa_debit',
          sepa_debit: { iban: input.iban },
        }),
        mandate_data: expect.objectContaining({
          customer_acceptance: expect.objectContaining({ type: 'online' }),
        }),
        metadata: { companyId: 'co-1' },
      }),
    );
  });

  it('ritorna ok:false in caso di errore Stripe', async () => {
    customersCreate.mockRejectedValue(new Error('stripe down'));
    const r = await setupSepaMandate(input);
    expect(r).toEqual({ ok: false, error: 'stripe down' });
  });
});

describe('applySepaMandateToAgency', () => {
  beforeEach(() => {
    customersCreate.mockReset();
    setupIntentsCreate.mockReset();
    companyUpdate.mockReset();
  });

  it('persiste gli id e ritorna ACTIVE quando il setup riesce', async () => {
    customersCreate.mockResolvedValue({ id: 'cus_1' });
    setupIntentsCreate.mockResolvedValue({ id: 'seti_1', payment_method: 'pm_1', mandate: 'mandate_1' });

    const status = await applySepaMandateToAgency(input);

    expect(status).toBe('ACTIVE');
    expect(companyUpdate).toHaveBeenCalledWith({
      where: { id: 'co-1' },
      data: {
        stripeCustomerId: 'cus_1',
        stripePaymentMethodId: 'pm_1',
        sepaMandateId: 'mandate_1',
        sepaMandateStatus: 'ACTIVE',
      },
    });
  });

  it('marca FAILED quando il setup fallisce', async () => {
    customersCreate.mockRejectedValue(new Error('boom'));
    const status = await applySepaMandateToAgency(input);
    expect(status).toBe('FAILED');
    expect(companyUpdate).toHaveBeenCalledWith({
      where: { id: 'co-1' },
      data: { sepaMandateStatus: 'FAILED' },
    });
  });
});
