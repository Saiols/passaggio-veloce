import { describe, it, expect, vi, beforeEach } from 'vitest';

const { prismaMock, visuraScadutaMock } = vi.hoisted(() => ({
  prismaMock: {
    wallet: { findMany: vi.fn(), findFirst: vi.fn() },
    payout: { findFirst: vi.fn(), create: vi.fn() },
  },
  visuraScadutaMock: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@pv/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/visura/stato', () => ({ isVisuraScadutaCompany: visuraScadutaMock }));

import { triggerAutoPayout } from './trigger-auto-payout';

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.payout.findFirst.mockResolvedValue(null);
  prismaMock.payout.create.mockResolvedValue({});
  // Se qualcuno rimettesse un guard aziendale sul saldo negativo, passerebbe
  // di qui: il mock risponde "c'è un wallet in rosso" e i test sotto
  // diventerebbero rossi.
  prismaMock.wallet.findFirst.mockResolvedValue({ id: 'w-negativo' });
  visuraScadutaMock.mockResolvedValue(false);
});

/**
 * Clausola 5 dei Termini, documento v8 (2026-07-26): il saldo negativo di un
 * wallet blocca il prelievo da quel wallet e basta. Questo job seleziona solo
 * wallet SOPRA soglia — quindi positivi — e non deve interessarsi degli altri.
 *
 * Prima del 2026-07-26 qui c'era il gemello del guard aziendale di
 * `eseguiPayoutImmediato` (`hasNegativeCompanyWallet`), messo perché il cron
 * crea il Payout RICHIESTO da sé e saltava il motore. Con la clausola
 * riscritta il guard non ha più ragione di esistere in nessuno dei due punti.
 */
describe('triggerAutoPayout — il saldo negativo altrui non ferma il cron (clausola 5)', () => {
  it("wallet sopra soglia con un altro wallet dell'azienda in rosso → payout creato comunque", async () => {
    prismaMock.wallet.findMany.mockResolvedValue([
      {
        id: 'w1',
        saldoCent: 150_000,
        companyId: null,
        sede: { payoutThresholdCent: 100_000, companyId: 'company-1' },
        company: null,
      },
    ]);

    const res = await triggerAutoPayout();

    expect(res).toEqual({ created: 1 });
    expect(prismaMock.payout.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          walletId: 'w1',
          importoCent: 150_000,
          stato: 'RICHIESTO',
          automatico: true,
        }),
      }),
    );
  });

  it('wallet sotto soglia → skip, nessun payout creato', async () => {
    prismaMock.wallet.findMany.mockResolvedValue([
      {
        id: 'w1',
        saldoCent: 50_000,
        companyId: null,
        sede: { payoutThresholdCent: 100_000, companyId: 'company-1' },
        company: null,
      },
    ]);

    const res = await triggerAutoPayout();

    expect(res).toEqual({ created: 0 });
    expect(prismaMock.payout.create).not.toHaveBeenCalled();
  });

  it('wallet a saldo negativo → sotto soglia per definizione, nessun payout', async () => {
    prismaMock.wallet.findMany.mockResolvedValue([
      {
        id: 'w1',
        saldoCent: -2_500,
        companyId: null,
        sede: { payoutThresholdCent: 100_000, companyId: 'company-1' },
        company: null,
      },
    ]);

    const res = await triggerAutoPayout();

    expect(res).toEqual({ created: 0 });
    expect(prismaMock.payout.create).not.toHaveBeenCalled();
  });
});

/**
 * Ciclo di vita visura camerale (clausola 8 dei Termini): questo job crea
 * Payout RICHIESTO direttamente (non passa da `eseguiPayoutImmediato`, che
 * ha il proprio guard visura), quindi il guard va replicato qui — altrimenti
 * la rete di sicurezza periodica (cron notturno) pagherebbe un wallet di
 * un'azienda con la visura scaduta. A differenza del saldo negativo (vedi
 * sopra), questo guard è tuttora aziendale: la clausola 8 sospende il prelievo
 * di TUTTI i wallet finché la visura non è aggiornata.
 */
/**
 * CRITICAL (review whole-branch): la sospensione era stata chiusa nel solo
 * `eseguiPayoutImmediato`. Questo job NON passa da lì — crea il Payout
 * `RICHIESTO` e `processPayouts` lo salda via `settlePayout`, che non ha alcun
 * guard di dominio. Effetto: il trigger in tempo reale rifiutava, il saldo
 * restava sopra soglia e questo cron pagava la notte dopo. La sospensione non
 * bloccava il payout automatico, lo rimandava di una notte.
 *
 * Le due forme di proprietà del wallet vanno inchiodate ENTRAMBE: `company`
 * diretta (wallet della madre, affiliazione) e `sede.company` (wallet
 * operativo). Sono entrambe producibili dal write path, e un guard che ne
 * guarda una sola non fallisce nessun test scritto sull'altra.
 */
describe('triggerAutoPayout — guard sospensione aziendale', () => {
  it('wallet di SEDE la cui azienda è sospesa → nessun payout creato', async () => {
    prismaMock.wallet.findMany.mockResolvedValue([
      {
        id: 'w1',
        saldoCent: 150_000,
        companyId: null,
        sede: {
          payoutThresholdCent: 100_000,
          companyId: 'company-1',
          company: { suspendedAt: new Date('2026-07-25T10:00:00Z') },
        },
        company: null,
      },
    ]);

    const res = await triggerAutoPayout();

    expect(res).toEqual({ created: 0 });
    expect(prismaMock.payout.create).not.toHaveBeenCalled();
  });

  it('wallet della COMPANY MADRE sospesa (affiliazione, sede null) → nessun payout creato', async () => {
    prismaMock.wallet.findMany.mockResolvedValue([
      {
        id: 'w-madre',
        saldoCent: 150_000,
        companyId: 'company-1',
        sede: null,
        company: {
          payoutThresholdCent: 100_000,
          suspendedAt: new Date('2026-07-25T10:00:00Z'),
        },
      },
    ]);

    const res = await triggerAutoPayout();

    expect(res).toEqual({ created: 0 });
    expect(prismaMock.payout.create).not.toHaveBeenCalled();
  });

  it('wallet della company madre NON sospesa → payout creato normalmente (il guard non blocca di più)', async () => {
    prismaMock.wallet.findMany.mockResolvedValue([
      {
        id: 'w-madre',
        saldoCent: 150_000,
        companyId: 'company-1',
        sede: null,
        company: { payoutThresholdCent: 100_000, suspendedAt: null },
      },
    ]);

    const res = await triggerAutoPayout();

    expect(res).toEqual({ created: 1 });
    expect(prismaMock.payout.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ walletId: 'w-madre', stato: 'RICHIESTO', automatico: true }),
      }),
    );
  });
});

describe('triggerAutoPayout — guard visura scaduta (clausola 8)', () => {
  it("wallet sopra soglia ma l'azienda ha la visura scaduta → nessun payout creato", async () => {
    prismaMock.wallet.findMany.mockResolvedValue([
      {
        id: 'w1',
        saldoCent: 150_000,
        companyId: null,
        sede: { payoutThresholdCent: 100_000, companyId: 'company-1' },
        company: null,
      },
    ]);
    visuraScadutaMock.mockResolvedValue(true);

    const res = await triggerAutoPayout();

    expect(res).toEqual({ created: 0 });
    expect(visuraScadutaMock).toHaveBeenCalledWith('company-1');
    expect(prismaMock.payout.create).not.toHaveBeenCalled();
  });

  it('visura valida → payout creato normalmente', async () => {
    prismaMock.wallet.findMany.mockResolvedValue([
      {
        id: 'w1',
        saldoCent: 150_000,
        companyId: null,
        sede: { payoutThresholdCent: 100_000, companyId: 'company-1' },
        company: null,
      },
    ]);
    visuraScadutaMock.mockResolvedValue(false);

    const res = await triggerAutoPayout();

    expect(res).toEqual({ created: 1 });
    expect(prismaMock.payout.create).toHaveBeenCalled();
  });
});
