import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Clausola 12.4 dei Termini: alla cancellazione dell'account
 * (`deleteCompanyAction`) il saldo residuo del wallet è liquidato
 * integralmente, ANCHE sotto la soglia dei 500 € (`ignoraSoglia: true`).
 *
 * Il blocco è best-effort per design (try/catch + `.catch(() => undefined)`):
 * un fallimento dell'erogazione non deve bloccare la cancellazione. Ma questo
 * lo rende silenzioso in caso di bug — se la query non trovasse i wallet, se
 * l'ordine fosse sbagliato, o se un'eccezione venisse inghiottita, la
 * cancellazione andrebbe comunque a buon fine e il denaro del cliente
 * resterebbe trattenuto senza alcun segnale. Questi test coprono esattamente
 * quel blocco (prima non esercitato da nessun test).
 */

const COMPANY_ID = 'company-1';
const RAGIONE_SOCIALE = 'Test SRL';

const { authMock, prismaMock, redirectMock, eseguiPayoutImmediatoMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  prismaMock: {
    company: { findUnique: vi.fn(), update: vi.fn() },
    wallet: { findMany: vi.fn(), findFirst: vi.fn() },
    // Righe RICHIESTO residue (vedi suspension-actions.saldo-residuo.test.ts):
    // qui il default è "nessuna riga residua", che è esattamente il caso che
    // questo file esercita (liquidazione "normale").
    payout: { findMany: vi.fn(), update: vi.fn() },
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

/**
 * `company.findUnique` è chiamato due volte con select diverse: il check
 * iniziale (`ragioneSociale`/`deletedAt`) e, dentro `notifyCompanyLifecycle`,
 * quella con `users`. Distinguerle per select evita dipendere dall'ordine.
 */
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
  prismaMock.wallet.findMany.mockResolvedValue([]);
  prismaMock.payout.findMany.mockResolvedValue([]);
  prismaMock.payout.update.mockResolvedValue({});
  // Nessun wallet negativo di default: la maggior parte dei test qui esercita
  // il percorso "liquidazione normale" (IMPORTANT, review finale pre-merge —
  // vedi suspension-actions.liquidazione-netting.test.ts per il caso con
  // debito).
  prismaMock.wallet.findFirst.mockResolvedValue(null);
  prismaMock.company.update.mockResolvedValue({});
  prismaMock.user.updateMany.mockResolvedValue({ count: 0 });
  eseguiPayoutImmediatoMock.mockResolvedValue({ ok: true, payoutId: 'p1', importoCent: 1 });
});

describe('deleteCompanyAction — liquidazione wallet alla cessazione (clausola 12.4)', () => {
  it('wallet madre sotto soglia (12.000 cent = 120€) → eseguiPayoutImmediato chiamato con { ignoraSoglia: true }', async () => {
    // La select di findMany è solo `{ id: true }`: il saldo non è visibile
    // qui (lo filtra la query, vedi test "filtra saldoCent > 0" sotto). Quel
    // che va provato è che il wallet trovato viene liquidato ignorando la
    // soglia dei 500€ — è l'adempimento della clausola 12.4.
    prismaMock.wallet.findMany.mockResolvedValue([{ id: 'wallet-madre' }]);

    const res = await deleteCompanyAction(COMPANY_ID, RAGIONE_SOCIALE);

    expect(res).toEqual({ ok: true });
    expect(eseguiPayoutImmediatoMock).toHaveBeenCalledWith('wallet-madre', { ignoraSoglia: true });
  });

  it('wallet madre + wallet di sede vengono liquidati; il where scoping esclude altre company', async () => {
    prismaMock.wallet.findMany.mockResolvedValue([{ id: 'wallet-madre' }, { id: 'wallet-sede' }]);

    await deleteCompanyAction(COMPANY_ID, RAGIONE_SOCIALE);

    // Il filtro deve scopare ESATTAMENTE su questa company (madre OR sedi di
    // questa company): un wallet di un'altra company non compare mai nel
    // risultato di questa query, quindi non viene mai passato a
    // eseguiPayoutImmediato.
    expect(prismaMock.wallet.findMany).toHaveBeenCalledWith({
      where: {
        OR: [{ companyId: COMPANY_ID }, { sede: { companyId: COMPANY_ID } }],
        saldoCent: { gt: 0 },
      },
      select: { id: true },
    });
    expect(eseguiPayoutImmediatoMock).toHaveBeenCalledTimes(2);
    expect(eseguiPayoutImmediatoMock).toHaveBeenNthCalledWith(1, 'wallet-madre', {
      ignoraSoglia: true,
    });
    expect(eseguiPayoutImmediatoMock).toHaveBeenNthCalledWith(2, 'wallet-sede', {
      ignoraSoglia: true,
    });
  });

  it('la query filtra saldoCent > 0: wallet senza saldo positivo → nessuna liquidazione', async () => {
    // Simula ciò che la query reale farebbe per wallet con saldo <= 0: non
    // compaiono nel risultato.
    prismaMock.wallet.findMany.mockResolvedValue([]);

    const res = await deleteCompanyAction(COMPANY_ID, RAGIONE_SOCIALE);

    expect(prismaMock.wallet.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ saldoCent: { gt: 0 } }) }),
    );
    expect(eseguiPayoutImmediatoMock).not.toHaveBeenCalled();
    expect(res).toEqual({ ok: true });
  });

  it('best-effort: eseguiPayoutImmediato che rigetta non blocca la cancellazione', async () => {
    prismaMock.wallet.findMany.mockResolvedValue([{ id: 'wallet-madre' }]);
    eseguiPayoutImmediatoMock.mockRejectedValue(new Error('provider down'));

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

  it('best-effort: eseguiPayoutImmediato che ritorna { ok: false } non blocca la cancellazione', async () => {
    prismaMock.wallet.findMany.mockResolvedValue([{ id: 'wallet-madre' }]);
    eseguiPayoutImmediatoMock.mockResolvedValue({ ok: false, error: 'IBAN mancante' });

    const res = await deleteCompanyAction(COMPANY_ID, RAGIONE_SOCIALE);

    expect(res).toEqual({ ok: true });
    expect(prismaMock.company.update).toHaveBeenCalled();
  });

  it('best-effort: se la query dei wallet lancia, la cancellazione procede comunque (try/catch esterno)', async () => {
    prismaMock.wallet.findMany.mockRejectedValue(new Error('db down'));

    const res = await deleteCompanyAction(COMPANY_ID, RAGIONE_SOCIALE);

    expect(res).toEqual({ ok: true });
    expect(eseguiPayoutImmediatoMock).not.toHaveBeenCalled();
    expect(prismaMock.company.update).toHaveBeenCalled();
    expect(prismaMock.user.updateMany).toHaveBeenCalled();
  });

  it('ordine: la liquidazione avviene PRIMA del soft-delete (company.update / user.updateMany)', async () => {
    const callOrder: string[] = [];
    prismaMock.wallet.findMany.mockImplementation(() => {
      callOrder.push('wallet.findMany');
      return Promise.resolve([{ id: 'wallet-madre' }]);
    });
    eseguiPayoutImmediatoMock.mockImplementation((walletId: string) => {
      callOrder.push(`eseguiPayoutImmediato:${walletId}`);
      return Promise.resolve({ ok: true, payoutId: 'p1', importoCent: 1 });
    });
    prismaMock.company.update.mockImplementation(() => {
      callOrder.push('company.update');
      return Promise.resolve({});
    });
    prismaMock.user.updateMany.mockImplementation(() => {
      callOrder.push('user.updateMany');
      return Promise.resolve({ count: 0 });
    });

    await deleteCompanyAction(COMPANY_ID, RAGIONE_SOCIALE);

    // Dopo il soft-delete i wallet potrebbero non essere più raggiungibili:
    // la liquidazione deve avvenire mentre l'azienda è ancora "viva".
    expect(callOrder.indexOf('eseguiPayoutImmediato:wallet-madre')).toBeGreaterThanOrEqual(0);
    expect(callOrder.indexOf('eseguiPayoutImmediato:wallet-madre')).toBeLessThan(
      callOrder.indexOf('company.update'),
    );
    expect(callOrder.indexOf('eseguiPayoutImmediato:wallet-madre')).toBeLessThan(
      callOrder.indexOf('user.updateMany'),
    );
  });
});

describe('deleteCompanyAction — guardie che precedono la liquidazione (sanity)', () => {
  it('conferma ragione sociale errata → nessuna liquidazione, nessun soft-delete', async () => {
    const res = await deleteCompanyAction(COMPANY_ID, 'Nome Sbagliato SRL');

    expect(res.ok).toBe(false);
    expect(eseguiPayoutImmediatoMock).not.toHaveBeenCalled();
    expect(prismaMock.company.update).not.toHaveBeenCalled();
  });

  it('ruolo non ADMIN_PIATTAFORMA → nessuna liquidazione, nessun soft-delete', async () => {
    authMock.mockResolvedValue({ user: { id: 'a2', role: 'ASSISTENTE' } });

    const res = await deleteCompanyAction(COMPANY_ID, RAGIONE_SOCIALE);

    expect(res.ok).toBe(false);
    expect(eseguiPayoutImmediatoMock).not.toHaveBeenCalled();
    expect(prismaMock.company.update).not.toHaveBeenCalled();
  });
});
