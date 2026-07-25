import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Prova end-to-end del punto A (vedi suspension-actions.saldo-residuo.test.ts
 * per il racconto completo della catena): a differenza di quel file, qui
 * `@/lib/wallet/payout-exec` NON è mockato — `eseguiPayoutImmediato` e
 * `settlePayout` sono le implementazioni REALI, mockate solo a livello di
 * `prisma`/provider di pagamento/documenti. Serve a dimostrare, non solo
 * dichiarare, che il controllo anti-doppio-payout dentro la transazione di
 * reserve (payout-exec.ts:269-273 — `tx.payout.findFirst({ stato: { in:
 * ['RICHIESTO','IN_LAVORAZIONE'] } })`, che NON va reso condizionale) smette
 * davvero di rifiutare "Payout già in corso" una volta che la riga RICHIESTO
 * residua è stata saldata dal nuovo codice PRIMA del ciclo di liquidazione.
 *
 * Lo stato della riga residua ('payout-R') è tracciato in una variabile
 * locale (`statoR`), aggiornata dagli stessi mock di `prisma`/`tx` che il
 * codice reale invoca: la transizione a IN_LAVORAZIONE (nuovo codice) e poi a
 * ESEGUITO (dentro `settlePayout`). L'inflight check di `eseguiPayoutImmediato`
 * legge quello stesso stato: se il nuovo codice non liquidasse la riga PRIMA,
 * questo test fallirebbe con l'errore "Payout già in corso, attendi" nel log
 * — esattamente il sintomo silenzioso descritto nel bug.
 */

const COMPANY_ID = 'company-1';
const RAGIONE_SOCIALE = 'Test SRL';
const WALLET_ID = 'wallet-1';
const RESIDUO_ID = 'payout-R';
const IBAN = 'IT60X0542811101';

const {
  authMock,
  prismaMock,
  txMock,
  executePayoutMock,
  getPaymentMock,
  createDocBrokerMock,
  createGiustificativoPromoMock,
} = vi.hoisted(() => {
  const txMock = {
    $queryRaw: vi.fn(),
    wallet: { findUnique: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
    payout: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    transazioneWallet: { updateMany: vi.fn(), create: vi.fn() },
  };
  const executePayoutMock = vi.fn();
  return {
    authMock: vi.fn(),
    txMock,
    executePayoutMock,
    getPaymentMock: vi.fn(() => ({ executePayout: executePayoutMock })),
    createDocBrokerMock: vi.fn(),
    createGiustificativoPromoMock: vi.fn(),
    prismaMock: {
      company: { findUnique: vi.fn(), update: vi.fn() },
      wallet: { findMany: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn() },
      payout: { findMany: vi.fn(), update: vi.fn(), updateMany: vi.fn(), findUnique: vi.fn() },
      user: { updateMany: vi.fn() },
      $transaction: vi.fn((arg: unknown) => {
        if (typeof arg === 'function') {
          return (arg as (tx: typeof txMock) => unknown)(txMock);
        }
        return Promise.all(arg as Promise<unknown>[]);
      }),
    },
  };
});

vi.mock('server-only', () => ({}));
vi.mock('@pv/db', () => ({ prisma: prismaMock }));
vi.mock('@/auth', () => ({ auth: authMock }));
vi.mock('next/navigation', () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`__REDIRECT__:${url}`);
  }),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/notifiche', () => ({ sendNotification: vi.fn(() => Promise.resolve()) }));
vi.mock('@/lib/fatturazione/engine', () => ({ createDocBroker: createDocBrokerMock }));
vi.mock('@/lib/fatturazione/giustificativo-promo', () => ({
  createGiustificativoPromo: createGiustificativoPromoMock,
}));
vi.mock('@/lib/providers/payment', () => ({ getPayment: getPaymentMock }));
// NOTA: @/lib/wallet/payout-exec NON è mockato — è l'oggetto della prova.

import { deleteCompanyAction } from './suspension-actions';

/** Stato della riga residua 'payout-R', l'unica cosa che questo test traccia. */
let statoR: 'RICHIESTO' | 'IN_LAVORAZIONE' | 'ESEGUITO' | 'FALLITO' = 'RICHIESTO';

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
  statoR = 'RICHIESTO';

  authMock.mockResolvedValue({ user: { id: 'admin-1', role: 'ADMIN_PIATTAFORMA' } });
  mockCompanyFindUnique();

  // Nessun debito aziendale (hasNegativeCompanyWallet, top-level).
  prismaMock.wallet.findFirst.mockResolvedValue(null);

  // deleteCompanyAction: una riga RICHIESTO residua su WALLET_ID, e quello
  // stesso wallet compare anche fra i wallet a saldo positivo (il residuo NON
  // è mai stato decrementato dal saldo: lo decrementa solo il settlement).
  prismaMock.payout.findMany.mockResolvedValue([{ id: RESIDUO_ID, walletId: WALLET_ID }]);
  prismaMock.wallet.findMany.mockResolvedValue([{ id: WALLET_ID }]);

  // Transizione a IN_LAVORAZIONE della riga residua (nuovo codice: compare-
  // and-set con prisma.payout.updateMany, condizionato a stato RICHIESTO —
  // DIVERSO da tx.payout.update usato dentro settlePayout per marcare
  // ESEGUITO, e da prisma.payout.update sotto, usato da settlePayout per
  // marcare FALLITO).
  prismaMock.payout.updateMany.mockImplementation(
    ({ where, data }: { where: { id: string; stato?: string }; data: { stato: string } }) => {
      if (where.id === RESIDUO_ID && data.stato === 'IN_LAVORAZIONE' && statoR === 'RICHIESTO') {
        statoR = 'IN_LAVORAZIONE';
        return Promise.resolve({ count: 1 });
      }
      return Promise.resolve({ count: 0 });
    },
  );

  // settlePayout (top-level, fuori transazione) marca FALLITO sia per IBAN
  // mancante sia per esito negativo del provider, tramite prisma.payout.update
  // (non tx): tracciamo anche questa transizione, perché è lo stato REALE che
  // il write path produce dopo un fallimento — non IN_LAVORAZIONE.
  prismaMock.payout.update.mockImplementation(
    ({ where, data }: { where: { id: string }; data: { stato: string } }) => {
      if (where.id === RESIDUO_ID && data.stato === 'FALLITO') statoR = 'FALLITO';
      return Promise.resolve({});
    },
  );

  // settlePayout (top-level, fuori transazione): risolve payout+wallet+IBAN
  // per id — sia per la riga residua sia per il payout "del resto" creato
  // dalla reserve di eseguiPayoutImmediato.
  prismaMock.payout.findUnique.mockImplementation(({ where }: { where: { id: string } }) => {
    if (where.id === RESIDUO_ID) {
      return Promise.resolve({
        id: RESIDUO_ID,
        walletId: WALLET_ID,
        importoCent: 30_000,
        automatico: true,
        wallet: { sede: null, company: { iban: IBAN } },
      });
    }
    return Promise.resolve({
      id: where.id,
      walletId: WALLET_ID,
      importoCent: 18_000,
      automatico: false,
      wallet: { sede: null, company: { iban: IBAN } },
    });
  });

  // Reserve tx di eseguiPayoutImmediato (ignoraSoglia: true → niente guard
  // pre-tx, niente check debito dentro la tx: il flusso arriva dritto
  // all'inflight check).
  txMock.$queryRaw.mockResolvedValue([{ id: WALLET_ID }]);
  txMock.wallet.findUnique.mockResolvedValue({
    id: WALLET_ID,
    saldoCent: 18_000, // "il resto" dopo il saldo (ipotetico) della riga residua
    companyId: COMPANY_ID,
    sede: null,
  });
  // L'INFLIGHT CHECK VERO: dipende dallo stato REALE della riga residua.
  txMock.payout.findFirst.mockImplementation(({ where }: { where: { walletId: string } }) => {
    if (where.walletId === WALLET_ID && (statoR === 'RICHIESTO' || statoR === 'IN_LAVORAZIONE')) {
      return Promise.resolve({ id: RESIDUO_ID });
    }
    return Promise.resolve(null);
  });
  txMock.payout.create.mockResolvedValue({ id: 'payout-resto' });
  txMock.wallet.update.mockResolvedValue({ saldoCent: 0 });
  txMock.transazioneWallet.updateMany.mockResolvedValue({ count: 0 });
  txMock.transazioneWallet.create.mockResolvedValue({});
  // Marca ESEGUITO la riga effettivamente saldata (tracciamo solo RESIDUO_ID).
  txMock.payout.update.mockImplementation(({ where, data }: { where: { id: string }; data: { stato: string } }) => {
    if (where.id === RESIDUO_ID && data.stato === 'ESEGUITO') statoR = 'ESEGUITO';
    return Promise.resolve({});
  });

  executePayoutMock.mockResolvedValue({ ok: true, providerRef: 'ref-1' });
  createDocBrokerMock.mockResolvedValue(undefined);
  createGiustificativoPromoMock.mockResolvedValue(undefined);

  prismaMock.company.update.mockResolvedValue({});
  prismaMock.user.updateMany.mockResolvedValue({ count: 0 });
});

describe('deleteCompanyAction — integrazione reale con payout-exec (nessun mock del motore)', () => {
  it('la riga RICHIESTO residua viene saldata PRIMA, e la liquidazione del resto NON fallisce più con "Payout già in corso"', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = await deleteCompanyAction(COMPANY_ID, RAGIONE_SOCIALE);

    expect(res).toEqual({ ok: true });

    // Nessun log menziona "Payout già in corso": se il nuovo codice non
    // avesse saldato la riga residua PRIMA, l'inflight check reale di
    // eseguiPayoutImmediato l'avrebbe trovata ancora RICHIESTO e questo
    // messaggio sarebbe comparso.
    const logged = consoleErrorSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(logged).not.toMatch(/già in corso/i);

    // Prova positiva, non solo assenza di errori: il provider di pagamento è
    // stato chiamato DUE volte — una per la riga residua (30.000 cent), una
    // per "il resto" liquidato dal ciclo esistente (18.000 cent). Se
    // l'inflight check avesse rifiutato il resto, la seconda chiamata non
    // ci sarebbe mai stata.
    expect(executePayoutMock).toHaveBeenCalledTimes(2);
    expect(executePayoutMock).toHaveBeenCalledWith(
      expect.objectContaining({ payoutId: RESIDUO_ID, importoCent: 30_000, iban: IBAN }),
    );
    expect(executePayoutMock).toHaveBeenCalledWith(
      expect.objectContaining({ payoutId: 'payout-resto', importoCent: 18_000, iban: IBAN }),
    );

    // La riga residua è arrivata fino a ESEGUITO (non solo IN_LAVORAZIONE).
    expect(statoR).toBe('ESEGUITO');

    consoleErrorSpy.mockRestore();
  });

  it('IBAN mancante sulla riga residua: settlePayout la marca FALLITO (mai IN_LAVORAZIONE) — il lock anti-doppione NON scatta e il resto del wallet viene comunque liquidato, ma il fallimento resta loggato', async () => {
    // Riscritto in review: la versione precedente di questo test asseriva
    // `statoR === 'IN_LAVORAZIONE'` dopo il fallimento, uno stato che il
    // write path reale non produce mai qui — settlePayout (payout-exec.ts)
    // marca esplicitamente FALLITO sia per IBAN mancante sia per un provider
    // che rigetta, MAI IN_LAVORAZIONE. E FALLITO non è fra gli stati inflight
    // (`RICHIESTO`/`IN_LAVORAZIONE`, payout-exec.ts:269-273): quindi il lock
    // anti-doppione della reserve per "il resto" del wallet NON la trova più,
    // e la liquidazione del resto procede — "Payout già in corso" NON
    // comparirebbe mai in questo scenario nel sistema reale. Questo test ora
    // verifica esattamente quel comportamento, non il suo opposto.
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    prismaMock.payout.findUnique.mockImplementation(({ where }: { where: { id: string } }) => {
      if (where.id === RESIDUO_ID) {
        return Promise.resolve({
          id: RESIDUO_ID,
          walletId: WALLET_ID,
          importoCent: 30_000,
          automatico: true,
          wallet: { sede: null, company: { iban: null } },
        });
      }
      return Promise.resolve({
        id: where.id,
        walletId: WALLET_ID,
        importoCent: 18_000,
        automatico: false,
        wallet: { sede: null, company: { iban: IBAN } },
      });
    });

    const res = await deleteCompanyAction(COMPANY_ID, RAGIONE_SOCIALE);

    expect(res).toEqual({ ok: true });
    // Stato reale del write path: FALLITO, non IN_LAVORAZIONE.
    expect(statoR).toBe('FALLITO');
    const logged = consoleErrorSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    // "Payout già in corso" NON compare: l'inflight check non trova più la
    // riga (FALLITO non è uno stato inflight), quindi il resto del wallet
    // non viene rifiutato.
    expect(logged).not.toMatch(/già in corso/i);
    // Il fallimento della riga residua resta comunque diagnosticabile
    // (difetto 2 del fix): l'id della riga e il motivo compaiono nel log.
    expect(logged).toMatch(new RegExp(RESIDUO_ID));
    expect(logged).toMatch(/IBAN mancante/);
    // Prova positiva: il resto del wallet (payout-resto, IBAN valido) viene
    // comunque liquidato — un'unica chiamata al provider, quella del resto,
    // non quella della riga residua (che si ferma prima, per IBAN mancante).
    expect(executePayoutMock).toHaveBeenCalledTimes(1);
    expect(executePayoutMock).toHaveBeenCalledWith(
      expect.objectContaining({ payoutId: 'payout-resto', importoCent: 18_000, iban: IBAN }),
    );

    consoleErrorSpy.mockRestore();
  });
});
