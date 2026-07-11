import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  prismaMock,
  txMock,
  getPaymentMock,
  executePayoutMock,
  createDocBrokerMock,
} = vi.hoisted(() => {
  const txMock = {
    wallet: { findUnique: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
    payout: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    transazioneWallet: { updateMany: vi.fn(), create: vi.fn() },
  };
  const executePayoutMock = vi.fn();
  return {
    txMock,
    executePayoutMock,
    getPaymentMock: vi.fn(() => ({ executePayout: executePayoutMock })),
    createDocBrokerMock: vi.fn(),
    prismaMock: {
      $transaction: vi.fn((cb: (tx: typeof txMock) => unknown) => cb(txMock)),
      payout: { findUnique: vi.fn(), update: vi.fn() },
    },
  };
});

vi.mock('server-only', () => ({}));
vi.mock('@pv/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/fatturazione/engine', () => ({ createDocBroker: createDocBrokerMock }));
vi.mock('@/lib/providers/payment', () => ({ getPayment: getPaymentMock }));

import { eseguiPayoutImmediato, settlePayout } from './payout-exec';

/** Payout risolto da settlePayout, con wallet di sede e IBAN valido. */
function payoutSede(over: Record<string, unknown> = {}) {
  return {
    id: 'p1',
    walletId: 'w1',
    importoCent: 80_000,
    automatico: false,
    wallet: { sede: { iban: 'IT60X0542811101', company: { iban: null } }, company: null },
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // reserve (transazione)
  txMock.wallet.findFirst.mockResolvedValue(null);
  txMock.payout.findFirst.mockResolvedValue(null);
  txMock.payout.create.mockResolvedValue({ id: 'p1' });
  txMock.wallet.update.mockResolvedValue({ saldoCent: 0 });
  txMock.transazioneWallet.updateMany.mockResolvedValue({ count: 2 });
  txMock.transazioneWallet.create.mockResolvedValue({});
  txMock.payout.update.mockResolvedValue({});
  // settlePayout (top-level)
  prismaMock.payout.findUnique.mockResolvedValue(payoutSede());
  prismaMock.payout.update.mockResolvedValue({});
  executePayoutMock.mockResolvedValue({ ok: true, providerRef: 'prov-1' });
  createDocBrokerMock.mockResolvedValue(undefined);
});

describe('eseguiPayoutImmediato', () => {
  it('saldo sotto soglia → errore, nessun payout, provider non chiamato', async () => {
    txMock.wallet.findUnique.mockResolvedValue({ id: 'w1', saldoCent: 10_000 });
    const r = await eseguiPayoutImmediato('w1');
    expect(r.ok).toBe(false);
    expect(txMock.payout.create).not.toHaveBeenCalled();
    expect(executePayoutMock).not.toHaveBeenCalled();
  });

  it('payout già in corso → errore', async () => {
    txMock.wallet.findUnique.mockResolvedValue({ id: 'w1', saldoCent: 80_000 });
    txMock.payout.findFirst.mockResolvedValue({ id: 'old' });
    const r = await eseguiPayoutImmediato('w1');
    expect(r).toEqual({ ok: false, error: 'Payout già in corso, attendi' });
    expect(txMock.payout.create).not.toHaveBeenCalled();
  });

  it('happy path → crea IN_LAVORAZIONE, paga via provider, salda ESEGUITO, genera documento', async () => {
    txMock.wallet.findUnique.mockResolvedValue({ id: 'w1', saldoCent: 80_000 });
    const r = await eseguiPayoutImmediato('w1');

    expect(r).toEqual({ ok: true, payoutId: 'p1', importoCent: 80_000 });
    // reserve: payout creato IN_LAVORAZIONE (non ESEGUITO subito)
    expect(txMock.payout.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          walletId: 'w1',
          importoCent: 80_000,
          stato: 'IN_LAVORAZIONE',
          automatico: false,
        }),
      }),
    );
    // provider chiamato con l'IBAN risolto
    expect(executePayoutMock).toHaveBeenCalledWith({
      payoutId: 'p1',
      importoCent: 80_000,
      iban: 'IT60X0542811101',
    });
    // settle: aggancia crediti, azzera saldo, marca ESEGUITO
    expect(txMock.transazioneWallet.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ walletId: 'w1', payoutId: null }),
        data: { payoutId: 'p1' },
      }),
    );
    expect(txMock.wallet.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'w1' }, data: { saldoCent: { decrement: 80_000 } } }),
    );
    expect(txMock.payout.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'p1' },
        data: expect.objectContaining({ stato: 'ESEGUITO', providerRef: 'prov-1' }),
      }),
    );
    expect(createDocBrokerMock).toHaveBeenCalledWith({ payoutId: 'p1' });
  });

  it('provider rifiuta (safeguard go-live) → Payout FALLITO, wallet NON svuotato', async () => {
    txMock.wallet.findUnique.mockResolvedValue({ id: 'w1', saldoCent: 80_000 });
    executePayoutMock.mockResolvedValue({
      ok: false,
      error: 'Payout reale non implementato (Strada B)',
      retryable: false,
    });

    const r = await eseguiPayoutImmediato('w1');

    expect(r).toEqual({ ok: false, error: 'Payout reale non implementato (Strada B)' });
    expect(prismaMock.payout.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'p1' },
        data: expect.objectContaining({ stato: 'FALLITO' }),
      }),
    );
    // niente svuotamento saldo, niente documento
    expect(txMock.wallet.update).not.toHaveBeenCalled();
    expect(createDocBrokerMock).not.toHaveBeenCalled();
  });

  it('IBAN mancante → Payout FALLITO, provider non chiamato, wallet NON svuotato', async () => {
    txMock.wallet.findUnique.mockResolvedValue({ id: 'w1', saldoCent: 80_000 });
    prismaMock.payout.findUnique.mockResolvedValue(
      payoutSede({ wallet: { sede: { iban: null, company: { iban: null } }, company: null } }),
    );

    const r = await eseguiPayoutImmediato('w1');

    expect(r.ok).toBe(false);
    expect(r).toMatchObject({ error: expect.stringContaining('IBAN') });
    expect(executePayoutMock).not.toHaveBeenCalled();
    expect(prismaMock.payout.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'p1' },
        data: expect.objectContaining({ stato: 'FALLITO', errorMessage: 'IBAN mancante' }),
      }),
    );
    expect(txMock.wallet.update).not.toHaveBeenCalled();
  });

  it('payout automatico → tipo movimento PAYOUT_AUTOMATICO', async () => {
    txMock.wallet.findUnique.mockResolvedValue({ id: 'w1', saldoCent: 80_000 });
    prismaMock.payout.findUnique.mockResolvedValue(payoutSede({ automatico: true }));

    await eseguiPayoutImmediato('w1', { automatico: true });

    expect(txMock.transazioneWallet.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ tipo: 'PAYOUT_AUTOMATICO' }) }),
    );
  });
});

/**
 * IMPORTANT 3 (review finale pre-merge): `richiediPayoutAction` filtrava gli
 * eleggibili wallet per wallet — un wallet a saldo negativo (penale) veniva
 * escluso, ma l'ALTRO wallet della stessa azienda (es. l'affiliazione)
 * veniva comunque pagato, lasciando il debito a registro indefinitamente e
 * contraddicendo il banner "payout bloccati" di /wallet. Fix: blocca OGNI
 * payout dell'azienda finché uno qualsiasi dei suoi wallet è negativo,
 * eccetto la liquidazione alla cessazione (`ignoraSoglia`, clausola 11.4),
 * che deve poter svuotare il residuo positivo a prescindere.
 */
describe('eseguiPayoutImmediato — guard saldo negativo aziendale (clausola 5)', () => {
  it('wallet eleggibile ma un altro wallet della stessa azienda è negativo → rifiutato, nessun payout creato', async () => {
    txMock.wallet.findUnique.mockResolvedValue({
      id: 'w1',
      saldoCent: 80_000,
      companyId: null,
      sedeId: 'sede-1',
      sede: { companyId: 'company-1' },
    });
    txMock.wallet.findFirst.mockResolvedValue({ id: 'w-negativo' });

    const r = await eseguiPayoutImmediato('w1');

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/negativo/i);
    expect(txMock.wallet.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: [{ companyId: 'company-1' }, { sede: { companyId: 'company-1' } }],
          saldoCent: { lt: 0 },
        }),
      }),
    );
    expect(txMock.payout.create).not.toHaveBeenCalled();
    expect(executePayoutMock).not.toHaveBeenCalled();
  });

  it("tutti i wallet dell'azienda sono ≥ 0 → payout consentito normalmente", async () => {
    txMock.wallet.findUnique.mockResolvedValue({
      id: 'w1',
      saldoCent: 80_000,
      companyId: null,
      sedeId: 'sede-1',
      sede: { companyId: 'company-1' },
    });
    txMock.wallet.findFirst.mockResolvedValue(null);

    const r = await eseguiPayoutImmediato('w1');

    expect(r.ok).toBe(true);
    expect(txMock.payout.create).toHaveBeenCalled();
  });

  it("liquidazione alla cessazione (ignoraSoglia) NON è bloccata da un wallet negativo di un'altra sede", async () => {
    txMock.wallet.findUnique.mockResolvedValue({
      id: 'w1',
      saldoCent: 30_000, // sotto soglia 500€: ammesso solo perché ignoraSoglia
      companyId: null,
      sedeId: 'sede-1',
      sede: { companyId: 'company-1' },
    });

    const r = await eseguiPayoutImmediato('w1', { ignoraSoglia: true });

    expect(r.ok).toBe(true);
    // Il guard non deve nemmeno interrogare gli altri wallet: la liquidazione
    // di cessazione è incondizionata sul saldo positivo del wallet stesso.
    expect(txMock.wallet.findFirst).not.toHaveBeenCalled();
    expect(txMock.payout.create).toHaveBeenCalled();
  });
});

describe('settlePayout (path job, wallet madre)', () => {
  it('salda un payout RICHIESTO esistente via IBAN madre → ESEGUITO', async () => {
    prismaMock.payout.findUnique.mockResolvedValue({
      id: 'pJob',
      walletId: 'w9',
      importoCent: 60_000,
      automatico: true,
      wallet: { sede: null, company: { iban: 'IT99A0301503200' } },
    });

    const r = await settlePayout('pJob');

    expect(r).toEqual({ ok: true, payoutId: 'pJob', importoCent: 60_000 });
    expect(executePayoutMock).toHaveBeenCalledWith({
      payoutId: 'pJob',
      importoCent: 60_000,
      iban: 'IT99A0301503200',
    });
    expect(txMock.payout.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'pJob' },
        data: expect.objectContaining({ stato: 'ESEGUITO' }),
      }),
    );
  });
});
