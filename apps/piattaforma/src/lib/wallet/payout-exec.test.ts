import { describe, it, expect, vi, beforeEach } from 'vitest';

const { prismaMock, txMock, createDocBrokerMock } = vi.hoisted(() => {
  const txMock = {
    wallet: { findUnique: vi.fn(), update: vi.fn() },
    payout: { findFirst: vi.fn(), create: vi.fn() },
    transazioneWallet: { updateMany: vi.fn(), create: vi.fn() },
  };
  return {
    txMock,
    prismaMock: {
      $transaction: vi.fn((cb: (tx: typeof txMock) => unknown) => cb(txMock)),
    },
    createDocBrokerMock: vi.fn(),
  };
});

vi.mock('server-only', () => ({}));
vi.mock('@pv/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/fatturazione/engine', () => ({ createDocBroker: createDocBrokerMock }));

import { eseguiPayoutImmediato } from './payout-exec';

beforeEach(() => {
  vi.clearAllMocks();
  txMock.payout.findFirst.mockResolvedValue(null);
  txMock.payout.create.mockResolvedValue({ id: 'p1' });
  txMock.wallet.update.mockResolvedValue({});
  txMock.transazioneWallet.updateMany.mockResolvedValue({ count: 2 });
  txMock.transazioneWallet.create.mockResolvedValue({});
  createDocBrokerMock.mockResolvedValue(undefined);
});

describe('eseguiPayoutImmediato', () => {
  it('saldo sotto soglia → errore, nessun payout', async () => {
    txMock.wallet.findUnique.mockResolvedValue({ id: 'w1', saldoCent: 10_000 });
    const r = await eseguiPayoutImmediato('w1');
    expect(r.ok).toBe(false);
    expect(txMock.payout.create).not.toHaveBeenCalled();
    expect(createDocBrokerMock).not.toHaveBeenCalled();
  });

  it('payout già in corso → errore', async () => {
    txMock.wallet.findUnique.mockResolvedValue({ id: 'w1', saldoCent: 80_000 });
    txMock.payout.findFirst.mockResolvedValue({ id: 'old' });
    const r = await eseguiPayoutImmediato('w1');
    expect(r).toEqual({ ok: false, error: 'Payout già in corso, attendi' });
    expect(txMock.payout.create).not.toHaveBeenCalled();
  });

  it('saldo sopra soglia → esegue subito: payout ESEGUITO, aggancia crediti, azzera saldo, genera documento', async () => {
    txMock.wallet.findUnique.mockResolvedValue({ id: 'w1', saldoCent: 80_000 });
    const r = await eseguiPayoutImmediato('w1');

    expect(r).toEqual({ ok: true, payoutId: 'p1', importoCent: 80_000 });
    expect(txMock.payout.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ stato: 'ESEGUITO', importoCent: 80_000, automatico: false }),
      }),
    );
    expect(txMock.transazioneWallet.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ walletId: 'w1', payoutId: null }),
        data: { payoutId: 'p1' },
      }),
    );
    expect(txMock.wallet.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'w1' }, data: { saldoCent: 0 } }),
    );
    expect(txMock.transazioneWallet.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ tipo: 'PAYOUT_MANUALE', importoCent: -80_000, payoutId: 'p1' }),
      }),
    );
    expect(createDocBrokerMock).toHaveBeenCalledWith({ payoutId: 'p1' });
  });

  it('payout automatico → tipo movimento PAYOUT_AUTOMATICO', async () => {
    txMock.wallet.findUnique.mockResolvedValue({ id: 'w1', saldoCent: 80_000 });
    await eseguiPayoutImmediato('w1', { automatico: true });
    expect(txMock.transazioneWallet.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ tipo: 'PAYOUT_AUTOMATICO' }) }),
    );
  });
});
