import { describe, it, expect, vi, beforeEach } from 'vitest';

const { feeUpdateMany, feeFindUnique, companyUpdateMany, blocca, rivaluta, isBloccata, ritentaMock } = vi.hoisted(() => ({
  feeUpdateMany: vi.fn(),
  feeFindUnique: vi.fn(),
  companyUpdateMany: vi.fn(),
  blocca: vi.fn(),
  rivaluta: vi.fn(),
  isBloccata: vi.fn(),
  ritentaMock: vi.fn(),
}));
vi.mock('@pv/db', () => ({
  prisma: {
    feeAddebito: { updateMany: feeUpdateMany, findUnique: feeFindUnique },
    company: { updateMany: companyUpdateMany },
  },
}));
vi.mock('@/lib/fee/blocco', () => ({
  bloccaAgenziaPerAddebito: blocca,
  rivalutaBloccoAgenzia: rivaluta,
  isAgenziaBloccata: isBloccata,
}));
vi.mock('@/lib/fee/retry', () => ({ ritentaAddebitiAgenzia: ritentaMock }));

import { handleStripeEvent } from './stripe-webhook';

describe('handleStripeEvent', () => {
  beforeEach(() => {
    feeUpdateMany.mockReset();
    feeFindUnique.mockReset();
    companyUpdateMany.mockReset();
    blocca.mockReset();
    rivaluta.mockReset();
    isBloccata.mockReset();
    ritentaMock.mockReset();
    feeUpdateMany.mockResolvedValue({ count: 1 });
    feeFindUnique.mockResolvedValue({ agenziaId: 'a1' });
    blocca.mockResolvedValue(undefined);
    rivaluta.mockResolvedValue(undefined);
    isBloccata.mockResolvedValue(false);
    ritentaMock.mockResolvedValue(undefined);
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

  it('setup_intent.succeeded → non chiama retry se agenzia non bloccata', async () => {
    isBloccata.mockResolvedValue(false);
    await handleStripeEvent({
      type: 'setup_intent.succeeded',
      data: { object: { id: 'seti_1', metadata: { companyId: 'co-1' } } },
    } as never);
    expect(ritentaMock).not.toHaveBeenCalled();
  });

  it('setup_intent.succeeded → auto-retry se agenzia era bloccata (PENDING→ACTIVE)', async () => {
    isBloccata.mockResolvedValue(true);
    await handleStripeEvent({
      type: 'setup_intent.succeeded',
      data: { object: { id: 'seti_1', metadata: { companyId: 'co-1' } } },
    } as never);
    expect(isBloccata).toHaveBeenCalledWith('co-1');
    expect(ritentaMock).toHaveBeenCalledWith('co-1');
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
