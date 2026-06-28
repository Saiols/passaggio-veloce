import { it, expect, vi, beforeEach } from 'vitest';

const { feeFindUnique, feeUpdate, chargeFee, blocca, rivaluta } = vi.hoisted(() => ({
  feeFindUnique: vi.fn(),
  feeUpdate: vi.fn(),
  chargeFee: vi.fn(),
  blocca: vi.fn(),
  rivaluta: vi.fn(),
}));

vi.mock('@pv/db', () => ({ prisma: { feeAddebito: { findUnique: feeFindUnique, update: feeUpdate } } }));
vi.mock('@/lib/providers/payment', () => ({ getPayment: () => ({ chargeFee }) }));
vi.mock('./blocco', () => ({ bloccaAgenziaPerAddebito: blocca, rivalutaBloccoAgenzia: rivaluta }));

import { processFeeAddebito } from './process';

const FEE = { id: 'f1', importoCent: 5000, agenziaId: 'a1', tentativi: 0, stato: 'SCHEDULED' };

beforeEach(() => {
  vi.clearAllMocks();
  feeUpdate.mockResolvedValue({});
  blocca.mockResolvedValue(undefined);
  rivaluta.mockResolvedValue(undefined);
  feeFindUnique.mockResolvedValue(FEE);
});

it('SUCCESS: marca SUCCESS e rivaluta lo sblocco', async () => {
  chargeFee.mockResolvedValue({ ok: true, providerRef: 'pi_1' });
  const s = await processFeeAddebito('f1');
  expect(s).toBe('SUCCESS');
  expect(rivaluta).toHaveBeenCalledWith('a1');
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
