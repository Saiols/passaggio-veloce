import { it, expect, vi, beforeEach } from 'vitest';

const { feeFindUnique, feeUpdate, feeUpdateMany, chargeFee, blocca, rivaluta, segnaIncassato, isPaymentLiveMock } =
  vi.hoisted(() => ({
    feeFindUnique: vi.fn(),
    feeUpdate: vi.fn(),
    feeUpdateMany: vi.fn(),
    chargeFee: vi.fn(),
    blocca: vi.fn(),
    rivaluta: vi.fn(),
    segnaIncassato: vi.fn(),
    isPaymentLiveMock: vi.fn(),
  }));

vi.mock('@pv/db', () => ({
  prisma: { feeAddebito: { findUnique: feeFindUnique, update: feeUpdate, updateMany: feeUpdateMany } },
}));
vi.mock('@/lib/providers/payment', () => ({ getPayment: () => ({ chargeFee }) }));
vi.mock('@/lib/jobs/payment-live', () => ({ isPaymentLive: isPaymentLiveMock }));
vi.mock('./blocco', () => ({ bloccaAgenziaPerAddebito: blocca, rivalutaBloccoAgenzia: rivaluta }));
vi.mock('./incasso', () => ({ segnaFeeIncassato: segnaIncassato }));

import { processFeeAddebito } from './process';

const FEE = { id: 'f1', importoCent: 5000, agenziaId: 'a1', tentativi: 0, stato: 'SCHEDULED' };

beforeEach(() => {
  vi.clearAllMocks();
  feeUpdate.mockResolvedValue({});
  feeUpdateMany.mockResolvedValue({ count: 1 }); // CAS success per default
  blocca.mockResolvedValue(undefined);
  rivaluta.mockResolvedValue(undefined);
  segnaIncassato.mockResolvedValue(true);
  feeFindUnique.mockResolvedValue(FEE);
  isPaymentLiveMock.mockReturnValue(true);
});

it('SUCCESS: delega la transizione a segnaFeeIncassato', async () => {
  chargeFee.mockResolvedValue({ ok: true, providerRef: 'pi_1' });
  const s = await processFeeAddebito('f1');
  expect(s).toBe('SUCCESS');
  expect(segnaIncassato).toHaveBeenCalledWith('f1', 'pi_1');
  expect(blocca).not.toHaveBeenCalled();
});

it('PENDING: resta IN_LAVORAZIONE, niente blocca/rivaluta', async () => {
  chargeFee.mockResolvedValue({ ok: true, providerRef: 'pi_1', pending: true });
  const s = await processFeeAddebito('f1');
  expect(s).toBe('PENDING');
  expect(blocca).not.toHaveBeenCalled();
  expect(rivaluta).not.toHaveBeenCalled();
});

it('FAILED: marca FAILED e blocca', async () => {
  chargeFee.mockResolvedValue({ ok: false, error: 'rifiutato', retryable: false });
  const s = await processFeeAddebito('f1');
  expect(s).toBe('FAILED');
  expect(blocca).toHaveBeenCalledWith('f1', 'rifiutato');
});

it('RETRY: marca RETRY e blocca', async () => {
  chargeFee.mockResolvedValue({ ok: false, error: 'transiente', retryable: true });
  const s = await processFeeAddebito('f1');
  expect(s).toBe('RETRY');
  expect(blocca).toHaveBeenCalledWith('f1', 'transiente');
});

it('passa il tentativo del fee a chargeFee', async () => {
  feeFindUnique.mockResolvedValue({ ...FEE, tentativi: 3 });
  chargeFee.mockResolvedValue({ ok: true, providerRef: 'pi_1' });
  await processFeeAddebito('f1');
  expect(chargeFee).toHaveBeenCalledWith(expect.objectContaining({ feeAddebitoId: 'f1', tentativo: 3 }));
});

it('SKIPPED: fee già SUCCESS', async () => {
  feeFindUnique.mockResolvedValue({ ...FEE, stato: 'SUCCESS' });
  const s = await processFeeAddebito('f1');
  expect(s).toBe('SKIPPED');
  expect(chargeFee).not.toHaveBeenCalled();
});

it('SKIPPED: fee già ANNULLATO', async () => {
  feeFindUnique.mockResolvedValue({ ...FEE, stato: 'ANNULLATO' });
  const s = await processFeeAddebito('f1');
  expect(s).toBe('SKIPPED');
  expect(chargeFee).not.toHaveBeenCalled();
});

it('SKIPPED: CAS updateMany restituisce count=0 (worker concorrente già ha il fee)', async () => {
  feeUpdateMany.mockResolvedValue({ count: 0 });
  const s = await processFeeAddebito('f1');
  expect(s).toBe('SKIPPED');
  expect(chargeFee).not.toHaveBeenCalled();
});

it('SKIPPED: provider non live, non tocca il provider di pagamento', async () => {
  isPaymentLiveMock.mockReturnValue(false);
  const s = await processFeeAddebito('f1');
  expect(s).toBe('SKIPPED');
  expect(chargeFee).not.toHaveBeenCalled();
  expect(feeUpdateMany).not.toHaveBeenCalled();
});
