import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Re-review pre-merge: la sospensione era chiusa sulla CREAZIONE del payout
 * (`lib/jobs/trigger-auto-payout.ts`) ma non sul SALDO. Una riga `RICHIESTO`
 * creata PRIMA della sospensione — finestra fra i due cron (01:00/01:30),
 * riga già in coda al deploy, residuo oltre BATCH_SIZE, o lasciata da un run
 * fallito — arriva comunque qui e `settlePayout` (lib/wallet/payout-exec.ts)
 * non ha alcun guard di dominio: risolve l'IBAN e chiama il provider. Terzo
 * punto del guard di sospensione (⚠️ GUARD DI TRIO, vedi payout-exec.ts),
 * l'unico sul SALDO anziché sulla creazione.
 *
 * Comportamento atteso: si SALTA (continue), non si annulla — nessuna
 * scrittura di stato sulla riga, che resta `RICHIESTO` e verrà saldata al
 * prossimo giro dopo la riattivazione.
 */

const { prismaMock, settlePayoutMock } = vi.hoisted(() => ({
  prismaMock: {
    payout: { findMany: vi.fn(), update: vi.fn() },
  },
  settlePayoutMock: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@pv/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/wallet/payout-exec', () => ({ settlePayout: settlePayoutMock }));

import { processPayouts } from './process-payouts';

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.payout.update.mockResolvedValue({});
  settlePayoutMock.mockResolvedValue({ ok: true, payoutId: 'p1', importoCent: 48_000 });
});

/** Riga RICHIESTO il cui wallet è di una SEDE la cui azienda è sospesa. */
function rigaDiSedeSospesa(id: string) {
  return {
    id,
    wallet: {
      company: null,
      sede: { company: { suspendedAt: new Date('2026-07-25T10:00:00Z') } },
    },
  };
}

/**
 * Riga RICHIESTO il cui wallet è della COMPANY MADRE sospesa (wallet
 * affiliazione, `sede` nullo) — seconda forma di proprietà, altrettanto
 * producibile dal write path.
 */
function rigaDiMadreSospesa(id: string) {
  return {
    id,
    wallet: {
      company: { suspendedAt: new Date('2026-07-25T10:00:00Z') },
      sede: null,
    },
  };
}

/** Riga RICHIESTO di un'azienda NON sospesa: controprova non tautologica. */
function rigaDiAziendaNonSospesa(id: string) {
  return {
    id,
    wallet: {
      company: null,
      sede: { company: { suspendedAt: null } },
    },
  };
}

describe('processPayouts — guard sospensione aziendale sul saldo', () => {
  it('riga RICHIESTO di una SEDE di azienda sospesa → settlePayout NON chiamata, nessuna scrittura di stato, resta RICHIESTO', async () => {
    prismaMock.payout.findMany.mockResolvedValue([rigaDiSedeSospesa('p1')]);

    const res = await processPayouts();

    expect(settlePayoutMock).not.toHaveBeenCalled();
    expect(prismaMock.payout.update).not.toHaveBeenCalled();
    expect(res).toEqual({ processed: 1, succeeded: 0, failed: 0 });
  });

  it('riga RICHIESTO della COMPANY MADRE sospesa (wallet affiliazione, sede nullo) → settlePayout NON chiamata, nessuna scrittura di stato', async () => {
    prismaMock.payout.findMany.mockResolvedValue([rigaDiMadreSospesa('p1')]);

    const res = await processPayouts();

    expect(settlePayoutMock).not.toHaveBeenCalled();
    expect(prismaMock.payout.update).not.toHaveBeenCalled();
    expect(res).toEqual({ processed: 1, succeeded: 0, failed: 0 });
  });

  it("riga RICHIESTO di azienda NON sospesa → settlePayout chiamata regolarmente (controprova: un guard che salta tutto non passerebbe questo caso)", async () => {
    prismaMock.payout.findMany.mockResolvedValue([rigaDiAziendaNonSospesa('p1')]);

    const res = await processPayouts();

    expect(prismaMock.payout.update).toHaveBeenCalledWith({
      where: { id: 'p1' },
      data: { stato: 'IN_LAVORAZIONE' },
    });
    expect(settlePayoutMock).toHaveBeenCalledWith('p1');
    expect(res).toEqual({ processed: 1, succeeded: 1, failed: 0 });
  });

  it('un lotto misto: la riga sospesa viene saltata, le altre due saldate normalmente', async () => {
    prismaMock.payout.findMany.mockResolvedValue([
      rigaDiAziendaNonSospesa('p1'),
      rigaDiSedeSospesa('p2'),
      rigaDiMadreSospesa('p3'),
      rigaDiAziendaNonSospesa('p4'),
    ]);

    const res = await processPayouts();

    expect(settlePayoutMock).toHaveBeenCalledTimes(2);
    expect(settlePayoutMock).toHaveBeenCalledWith('p1');
    expect(settlePayoutMock).toHaveBeenCalledWith('p4');
    expect(settlePayoutMock).not.toHaveBeenCalledWith('p2');
    expect(settlePayoutMock).not.toHaveBeenCalledWith('p3');
    expect(prismaMock.payout.update).toHaveBeenCalledTimes(2);
    expect(res).toEqual({ processed: 4, succeeded: 2, failed: 0 });
  });
});
