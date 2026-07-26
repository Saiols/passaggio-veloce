import { describe, it, expect, vi, beforeEach } from 'vitest';

const { feeUpdateMany, feeFindUnique, companyUpdateMany, blocca, rivaluta, isBloccata, ritentaMock, segnaIncassato } =
  vi.hoisted(() => ({
    feeUpdateMany: vi.fn(),
    feeFindUnique: vi.fn(),
    companyUpdateMany: vi.fn(),
    blocca: vi.fn(),
    rivaluta: vi.fn(),
    isBloccata: vi.fn(),
    ritentaMock: vi.fn(),
    segnaIncassato: vi.fn(),
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
vi.mock('@/lib/fee/incasso', () => ({ segnaFeeIncassato: segnaIncassato }));
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
    segnaIncassato.mockReset();
    feeUpdateMany.mockResolvedValue({ count: 1 });
    feeFindUnique.mockResolvedValue({ agenziaId: 'a1' });
    blocca.mockResolvedValue(undefined);
    rivaluta.mockResolvedValue(undefined);
    isBloccata.mockResolvedValue(false);
    ritentaMock.mockResolvedValue(undefined);
    segnaIncassato.mockResolvedValue(true);
  });

  it('payment_intent.succeeded → fee SUCCESS via metadata', async () => {
    await handleStripeEvent({
      type: 'payment_intent.succeeded',
      data: { object: { id: 'pi_1', metadata: { feeAddebitoId: 'fee-1' } } },
    } as never);
    expect(segnaIncassato).toHaveBeenCalledWith('fee-1', 'pi_1');
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

  it('setup_intent.succeeded → chiama retry incondizionatamente anche se agenzia non bloccata', async () => {
    isBloccata.mockResolvedValue(false);
    await handleStripeEvent({
      type: 'setup_intent.succeeded',
      data: { object: { id: 'seti_1', metadata: { companyId: 'co-1' } } },
    } as never);
    // Unconditional: qualsiasi fee FAILED/RETRY viene rilancito appena il mandato è ACTIVE
    expect(ritentaMock).toHaveBeenCalledWith('co-1');
  });

  it('setup_intent.succeeded → auto-retry incondizionato (mandato PENDING→ACTIVE)', async () => {
    await handleStripeEvent({
      type: 'setup_intent.succeeded',
      data: { object: { id: 'seti_1', metadata: { companyId: 'co-1' } } },
    } as never);
    // Non dipende più dallo stato di blocco: ritenta sempre (no-op se non ci sono fee pendenti)
    expect(ritentaMock).toHaveBeenCalledWith('co-1');
    expect(isBloccata).not.toHaveBeenCalled();
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
