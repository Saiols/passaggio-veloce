import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Il guard sta nel motore, non nell'action: il payout manuale e l'auto-payout a
 * soglia in tempo reale passano da qui (vedi lib/wallet/auto-payout.ts:45).
 *
 * ⚠️ NON tutti i percorsi: il cron notturno
 * (`lib/jobs/trigger-auto-payout.ts`) crea il Payout `RICHIESTO` da sé e lo fa
 * saldare da `processPayouts` → `settlePayout`, che non ha guard di dominio. Il
 * suo guard è replicato là e testato in `lib/jobs/trigger-auto-payout.test.ts`:
 * questo file NON lo copre, e per un po' la spec sosteneva il contrario.
 */

const WALLET_ID = 'wallet-1';

const { prismaMock, isVisuraScadutaMock } = vi.hoisted(() => ({
  prismaMock: {
    wallet: { findUnique: vi.fn() },
    $transaction: vi.fn(),
  },
  isVisuraScadutaMock: vi.fn(),
}));

vi.mock('@pv/db', () => ({ prisma: prismaMock }));
// `isVisuraScadutaCompany` vive in `@/lib/visura/stato` (non in `validita`,
// che espone solo le funzioni pure di calcolo date) — stesso modulo mockato
// da payout-exec.test.ts e payout-liquidazione.test.ts.
vi.mock('@/lib/visura/stato', () => ({ isVisuraScadutaCompany: isVisuraScadutaMock }));

import { eseguiPayoutImmediato } from './payout-exec';

beforeEach(() => {
  vi.clearAllMocks();
  isVisuraScadutaMock.mockResolvedValue(false);
  // La reserve fallisce per saldo non erogabile. `eseguiPayoutImmediato` fa
  // `if (!reserve.ok) return reserve` (payout-exec.ts:258), quindi la funzione
  // torna subito dopo i guard senza mai raggiungere il provider di pagamento.
  // Senza questo mock `$transaction` risolverebbe `undefined` e il test che
  // verifica l'esenzione `ignoraSoglia` lancerebbe invece di asserire.
  prismaMock.$transaction.mockResolvedValue({ ok: false, error: 'Saldo non erogabile' });
});

/** Wallet di sede la cui company è sospesa. */
function walletDiCompanySospesa() {
  prismaMock.wallet.findUnique.mockResolvedValue({
    companyId: null,
    company: null,
    sede: { companyId: 'c1', company: { suspendedAt: new Date('2026-07-25T10:00:00Z') } },
  });
}

/**
 * Wallet della company MADRE (affiliazione) sospesa: `company.suspendedAt`
 * diretto, `sede: null`. È la seconda forma di proprietà del wallet, altrettanto
 * producibile dal write path — il caso positivo qui sopra passa solo per la
 * relazione sede, quindi da solo non inchioda niente su questa.
 */
function walletDiMadreSospesa() {
  prismaMock.wallet.findUnique.mockResolvedValue({
    companyId: 'c1',
    company: { suspendedAt: new Date('2026-07-25T10:00:00Z') },
    sede: null,
  });
}

describe('eseguiPayoutImmediato — azienda sospesa', () => {
  it('rifiuta senza aprire la transazione di reserve', async () => {
    walletDiCompanySospesa();

    const res = await eseguiPayoutImmediato(WALLET_ID);

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/sospes/i);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('rifiuta anche il wallet della company madre sospesa (wallet affiliazione)', async () => {
    walletDiMadreSospesa();

    const res = await eseguiPayoutImmediato(WALLET_ID);

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/sospes/i);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('rifiuta anche il payout automatico (soglia in tempo reale passa da qui)', async () => {
    walletDiCompanySospesa();

    const res = await eseguiPayoutImmediato(WALLET_ID, { automatico: true });

    expect(res.ok).toBe(false);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('NON rifiuta sotto ignoraSoglia: la liquidazione di cessazione resta possibile', async () => {
    // Clausola 12.4 dei Termini: alla cessazione il saldo residuo è liquidato
    // integralmente. `deleteCompanyAction` marca suspendedAt E deletedAt, quindi
    // senza questa esenzione il denaro dovuto resterebbe intrappolato per sempre.
    walletDiCompanySospesa();

    const res = await eseguiPayoutImmediato(WALLET_ID, { ignoraSoglia: true });

    // Il guard NON ha corto-circuitato: si è arrivati alla reserve, e l'errore
    // che torna è quello del saldo, non quello della sospensione.
    expect(prismaMock.$transaction).toHaveBeenCalled();
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).not.toMatch(/sospes/i);
  });

  it('wallet di company madre non sospesa → prosegue verso il guard visura', async () => {
    prismaMock.wallet.findUnique.mockResolvedValue({
      companyId: 'c1',
      company: { suspendedAt: null },
      sede: null,
    });
    isVisuraScadutaMock.mockResolvedValue(true);

    const res = await eseguiPayoutImmediato(WALLET_ID);

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/visura/i);
  });
});
