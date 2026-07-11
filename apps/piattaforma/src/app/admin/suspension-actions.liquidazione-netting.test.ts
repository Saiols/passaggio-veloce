import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * IMPORTANT (review finale pre-merge, ultima ondata): `deleteCompanyAction`
 * pagava tutti i wallet con `saldoCent > 0` e non compensava quelli
 * negativi. Un'azienda con sede A a -25€ (penale non ripianata) e sede B a
 * +600€ veniva liquidata di 600€ e il debito di 25€ semplicemente spariva —
 * in contrasto con la clausola 11.4 dei Termini, che liquida il residuo
 * "previa... regolarizzazione di quanto eventualmente dovuto a Passaggio
 * Veloce".
 *
 * Fix scelto: BLOCCO della liquidazione automatica (non netting contabile)
 * quando esiste un qualsiasi wallet negativo dell'azienda — vedi il
 * commento su `deleteCompanyAction` per il perché. Questi test coprono
 * esattamente quel guard, riusando `hasNegativeCompanyWallet` (già usata da
 * `payout-exec.ts`).
 */

const COMPANY_ID = 'company-1';
const RAGIONE_SOCIALE = 'Test SRL';

const { authMock, prismaMock, redirectMock, eseguiPayoutImmediatoMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  prismaMock: {
    company: { findUnique: vi.fn(), update: vi.fn() },
    wallet: { findMany: vi.fn(), findFirst: vi.fn() },
    user: { updateMany: vi.fn() },
    $transaction: vi.fn((ops: unknown[]) => Promise.all(ops)),
  },
  redirectMock: vi.fn((url: string) => {
    throw new Error(`__REDIRECT__:${url}`);
  }),
  eseguiPayoutImmediatoMock: vi.fn(),
}));

vi.mock('@pv/db', () => ({ prisma: prismaMock }));
vi.mock('@/auth', () => ({ auth: authMock }));
vi.mock('next/navigation', () => ({ redirect: redirectMock }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/notifiche', () => ({ sendNotification: vi.fn(() => Promise.resolve()) }));
vi.mock('@/lib/wallet/payout-exec', () => ({ eseguiPayoutImmediato: eseguiPayoutImmediatoMock }));

import { deleteCompanyAction } from './suspension-actions';

function mockCompanyFindUnique() {
  prismaMock.company.findUnique.mockImplementation(
    (args: { select?: { users?: unknown } }) => {
      if (args.select?.users) {
        return Promise.resolve({ id: COMPANY_ID, ragioneSociale: RAGIONE_SOCIALE, users: [] });
      }
      return Promise.resolve({ ragioneSociale: RAGIONE_SOCIALE, deletedAt: null });
    },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  authMock.mockResolvedValue({ user: { id: 'admin-1', role: 'ADMIN_PIATTAFORMA' } });
  mockCompanyFindUnique();
  prismaMock.company.update.mockResolvedValue({});
  prismaMock.user.updateMany.mockResolvedValue({ count: 0 });
  eseguiPayoutImmediatoMock.mockResolvedValue({ ok: true, payoutId: 'p1', importoCent: 1 });
});

describe('deleteCompanyAction — blocco liquidazione con wallet misti (clausola 11.4)', () => {
  it('sede A a -25€, sede B a +600€ → nessun payout eseguito (il debito blocca la liquidazione automatica)', async () => {
    // hasNegativeCompanyWallet trova il wallet negativo → true.
    prismaMock.wallet.findFirst.mockResolvedValue({ id: 'wallet-sede-a' });
    prismaMock.wallet.findMany.mockResolvedValue([{ id: 'wallet-sede-b' }]);

    const res = await deleteCompanyAction(COMPANY_ID, RAGIONE_SOCIALE);

    expect(res).toEqual({ ok: true });
    // Il pre-check scopa sulla company corretta (madre OR sedi di questa company).
    expect(prismaMock.wallet.findFirst).toHaveBeenCalledWith({
      where: {
        OR: [{ companyId: COMPANY_ID }, { sede: { companyId: COMPANY_ID } }],
        saldoCent: { lt: 0 },
      },
      select: { id: true },
    });
    // Nessun payout: il wallet positivo NON viene liquidato finché il debito
    // non è regolarizzato.
    expect(eseguiPayoutImmediatoMock).not.toHaveBeenCalled();
    // La query dei wallet positivi non è nemmeno necessaria: si esce prima.
    expect(prismaMock.wallet.findMany).not.toHaveBeenCalled();
  });

  it('la company viene comunque cancellata (soft delete) anche se la liquidazione è bloccata dal debito', async () => {
    prismaMock.wallet.findFirst.mockResolvedValue({ id: 'wallet-sede-a' });

    const res = await deleteCompanyAction(COMPANY_ID, RAGIONE_SOCIALE);

    expect(res).toEqual({ ok: true });
    expect(prismaMock.company.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: COMPANY_ID },
        data: expect.objectContaining({ deletedAt: expect.any(Date) }),
      }),
    );
    expect(prismaMock.user.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { companyId: COMPANY_ID, deletedAt: null },
        data: expect.objectContaining({ status: 'SUSPENDED', deletedAt: expect.any(Date) }),
      }),
    );
  });

  it('nessun wallet negativo → comportamento invariato: i wallet positivi vengono liquidati', async () => {
    prismaMock.wallet.findFirst.mockResolvedValue(null);
    prismaMock.wallet.findMany.mockResolvedValue([{ id: 'wallet-madre' }, { id: 'wallet-sede' }]);

    const res = await deleteCompanyAction(COMPANY_ID, RAGIONE_SOCIALE);

    expect(res).toEqual({ ok: true });
    expect(eseguiPayoutImmediatoMock).toHaveBeenCalledTimes(2);
    expect(eseguiPayoutImmediatoMock).toHaveBeenNthCalledWith(1, 'wallet-madre', {
      ignoraSoglia: true,
    });
    expect(eseguiPayoutImmediatoMock).toHaveBeenNthCalledWith(2, 'wallet-sede', {
      ignoraSoglia: true,
    });
  });

  it('best-effort: se il pre-check del debito lancia, la cancellazione procede comunque senza liquidare', async () => {
    prismaMock.wallet.findFirst.mockRejectedValue(new Error('db down'));

    const res = await deleteCompanyAction(COMPANY_ID, RAGIONE_SOCIALE);

    expect(res).toEqual({ ok: true });
    expect(eseguiPayoutImmediatoMock).not.toHaveBeenCalled();
    expect(prismaMock.company.update).toHaveBeenCalled();
    expect(prismaMock.user.updateMany).toHaveBeenCalled();
  });
});
