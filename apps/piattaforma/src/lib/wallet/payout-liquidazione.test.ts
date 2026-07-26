import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Clausole 5 e 12.4 dei Termini: alla cessazione del rapporto il saldo residuo
 * è liquidato integralmente ANCHE se inferiore a 500 €. Oggi MIN_PAYOUT_CENT
 * gatea anche l'admin, quindi la promessa contrattuale sarebbe ineseguibile.
 * `ignoraSoglia` è il solo modo di onorarla — e NON deve essere raggiungibile
 * dal path utente.
 *
 * Nota sui mock: `settlePayout` vive nello stesso modulo di
 * `eseguiPayoutImmediato` (non in un file `./settle` separato) e
 * `createDocBroker` si importa da `@/lib/fatturazione/engine` (non da
 * `@/lib/fatturazione/doc-broker`). I mock qui rispecchiano la struttura
 * reale — stesso pattern di `payout-exec.test.ts` — così il path
 * "ignoraSoglia → eseguito" attraversa davvero `settlePayout`.
 */

const { prismaMock, txMock, executePayoutMock, createDocBrokerMock, visuraScadutaMock } = vi.hoisted(() => {
  const txMock = {
    $queryRaw: vi.fn(),
    wallet: { findUnique: vi.fn(), update: vi.fn() },
    payout: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    transazioneWallet: { updateMany: vi.fn(), create: vi.fn() },
  };
  const executePayoutMock = vi.fn();
  return {
    txMock,
    executePayoutMock,
    createDocBrokerMock: vi.fn(),
    visuraScadutaMock: vi.fn(),
    prismaMock: {
      $transaction: vi.fn((cb: (tx: typeof txMock) => unknown) => cb(txMock)),
      payout: { findUnique: vi.fn(), update: vi.fn() },
      wallet: { findUnique: vi.fn() },
    },
  };
});

vi.mock('@pv/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/fatturazione/engine', () => ({ createDocBroker: createDocBrokerMock }));
vi.mock('@/lib/providers/payment', () => ({
  getPayment: vi.fn(() => ({ executePayout: executePayoutMock })),
}));
vi.mock('@/lib/visura/stato', () => ({ isVisuraScadutaCompany: visuraScadutaMock }));

import { eseguiPayoutImmediato } from './payout-exec';
import { WALLET } from './config';

const W = 'wallet-1';
const SOTTO_SOGLIA = WALLET.MIN_PAYOUT_CENT - 1; // 499,99 €

beforeEach(() => {
  vi.clearAllMocks();
  // guard visura (clausola 8), fuori transazione: mai scaduta di default —
  // non è l'oggetto di questi test, che coprono la soglia/il debito.
  prismaMock.wallet.findUnique.mockResolvedValue({ companyId: 'company-1', sede: null });
  visuraScadutaMock.mockResolvedValue(false);
  // reserve: il row lock FOR UPDATE è un no-op nel mock.
  txMock.$queryRaw.mockResolvedValue([{ id: W }]);
  txMock.wallet.findUnique.mockResolvedValue({ id: W, saldoCent: SOTTO_SOGLIA });
  txMock.payout.findFirst.mockResolvedValue(null);
  txMock.payout.create.mockResolvedValue({ id: 'payout-1' });
  txMock.wallet.update.mockResolvedValue({ saldoCent: 0 });
  txMock.transazioneWallet.updateMany.mockResolvedValue({ count: 0 });
  txMock.transazioneWallet.create.mockResolvedValue({});
  txMock.payout.update.mockResolvedValue({});
  // settlePayout (path job/istantaneo, top-level prisma): serve solo per lo
  // scenario "ignoraSoglia → eseguito", che attraversa il settlement reale.
  prismaMock.payout.findUnique.mockResolvedValue({
    id: 'payout-1',
    walletId: W,
    importoCent: SOTTO_SOGLIA,
    automatico: false,
    wallet: { sede: { iban: 'IT60X0542811101', company: { iban: null } }, company: null },
  });
  prismaMock.payout.update.mockResolvedValue({});
  executePayoutMock.mockResolvedValue({ ok: true, providerRef: 'ref-1' });
  createDocBrokerMock.mockResolvedValue(undefined);
});

describe('eseguiPayoutImmediato — liquidazione alla cessazione', () => {
  it('saldo sotto soglia SENZA ignoraSoglia → rifiutato (comportamento utente invariato)', async () => {
    const res = await eseguiPayoutImmediato(W);

    expect(res.ok).toBe(false);
    expect(txMock.payout.create).not.toHaveBeenCalled();
  });

  it('saldo sotto soglia CON ignoraSoglia → eseguito per l_intero residuo', async () => {
    const res = await eseguiPayoutImmediato(W, { ignoraSoglia: true });

    expect(res.ok).toBe(true);
    expect(txMock.payout.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ importoCent: SOTTO_SOGLIA }),
      }),
    );
  });

  it('saldo NEGATIVO con ignoraSoglia → comunque rifiutato (non si bonifica un debito)', async () => {
    txMock.wallet.findUnique.mockResolvedValue({ id: W, saldoCent: -5_000 });

    const res = await eseguiPayoutImmediato(W, { ignoraSoglia: true });

    expect(res.ok).toBe(false);
    expect(txMock.payout.create).not.toHaveBeenCalled();
  });

  /**
   * IMPORTANT (code review, commit 0882317): il guard visura NON era escluso
   * da `ignoraSoglia`. `deleteCompanyAction` scarta l'esito del payout con
   * `.catch(() => undefined)`, quindi un rifiuto qui spariva in silenzio; e
   * dopo il soft delete l'utente non può più sanare la visura scaduta
   * (`/visura` richiede login, che richiede `deletedAt: null` — irraggiungibile).
   * Il denaro dovuto restava intrappolato per sempre. Una visura scaduta non è
   * un debito verso PV: il guard deve saltare. (Il debito da saldo negativo,
   * invece, non passa più di qui: dal 2026-07-26 blocca solo il proprio
   * wallet — clausola 5 — e alla cessazione lo intercetta a monte
   * `deleteCompanyAction`.)
   */
  it('visura SCADUTA con ignoraSoglia → eseguito comunque (una visura scaduta non è un debito)', async () => {
    visuraScadutaMock.mockResolvedValue(true);

    const res = await eseguiPayoutImmediato(W, { ignoraSoglia: true });

    expect(res.ok).toBe(true);
    expect(txMock.payout.create).toHaveBeenCalled();
  });

  it('visura SCADUTA SENZA ignoraSoglia → resta rifiutato (comportamento utente invariato)', async () => {
    visuraScadutaMock.mockResolvedValue(true);
    txMock.wallet.findUnique.mockResolvedValue({ id: W, saldoCent: 80_000 });

    const res = await eseguiPayoutImmediato(W);

    expect(res.ok).toBe(false);
    expect(txMock.payout.create).not.toHaveBeenCalled();
  });
});
