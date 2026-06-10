import { describe, it, expect, vi, beforeEach } from 'vitest';

const { feeUpdateMany, companyUpdateMany } = vi.hoisted(() => ({
  feeUpdateMany: vi.fn(),
  companyUpdateMany: vi.fn(),
}));
vi.mock('@pv/db', () => ({
  prisma: {
    feeAddebito: { updateMany: feeUpdateMany },
    company: { updateMany: companyUpdateMany },
  },
}));

import { handleStripeEvent } from './stripe-webhook';

describe('handleStripeEvent', () => {
  beforeEach(() => {
    feeUpdateMany.mockReset();
    companyUpdateMany.mockReset();
  });

  it('payment_intent.succeeded → fee SUCCESS via metadata', async () => {
    await handleStripeEvent({
      type: 'payment_intent.succeeded',
      data: { object: { id: 'pi_1', metadata: { feeAddebitoId: 'fee-1' } } },
    } as never);
    expect(feeUpdateMany).toHaveBeenCalledWith({
      where: { id: 'fee-1', stato: { not: 'SUCCESS' } },
      data: { stato: 'SUCCESS', providerRef: 'pi_1', executedAt: expect.any(Date), errorMessage: null },
    });
  });

  it('payment_intent.payment_failed → fee FAILED', async () => {
    await handleStripeEvent({
      type: 'payment_intent.payment_failed',
      data: { object: { id: 'pi_2', metadata: { feeAddebitoId: 'fee-2' }, last_payment_error: { message: 'rifiutato' } } },
    } as never);
    expect(feeUpdateMany).toHaveBeenCalledWith({
      where: { id: 'fee-2', stato: { notIn: ['SUCCESS', 'FAILED'] } },
      data: { stato: 'FAILED', errorMessage: 'rifiutato' },
    });
  });

  it('setup_intent.succeeded → mandato ACTIVE via metadata.companyId', async () => {
    await handleStripeEvent({
      type: 'setup_intent.succeeded',
      data: { object: { id: 'seti_1', metadata: { companyId: 'co-1' } } },
    } as never);
    expect(companyUpdateMany).toHaveBeenCalledWith({
      where: { id: 'co-1' },
      data: { sepaMandateStatus: 'ACTIVE' },
    });
  });

  it('setup_intent.setup_failed → mandato FAILED', async () => {
    await handleStripeEvent({
      type: 'setup_intent.setup_failed',
      data: { object: { id: 'seti_2', metadata: { companyId: 'co-2' } } },
    } as never);
    expect(companyUpdateMany).toHaveBeenCalledWith({
      where: { id: 'co-2' },
      data: { sepaMandateStatus: 'FAILED' },
    });
  });

  it('evento non gestito → no-op', async () => {
    await handleStripeEvent({ type: 'charge.updated', data: { object: {} } } as never);
    expect(feeUpdateMany).not.toHaveBeenCalled();
    expect(companyUpdateMany).not.toHaveBeenCalled();
  });
});
