import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Quarta ricorrenza della stessa famiglia di guasto (dopo: guard sospensione
 * sul saldo in `process-payouts.test.ts`, blocco su wallet negativo in
 * `suspension-actions.liquidazione-netting.test.ts`, guard visura scaduta in
 * `payout-liquidazione.test.ts`). Catena verificata (re-review pre-merge):
 *
 *  1. Una riga `Payout` RICHIESTO sopravvive alla notte in cui è stata creata
 *     (batch oltre BATCH_SIZE, run del cron fallito, finestra fra i due cron).
 *  2. L'azienda viene sospesa: da quel momento `processPayouts` la salta a
 *     ogni giro (guard corretto, lib/jobs/process-payouts.ts) finché la
 *     sospensione dura.
 *  3. L'azienda viene poi cancellata mentre è ancora sospesa (caso normale:
 *     `deleteCompanyAction` marca `suspendedAt` insieme a `deletedAt`, senza
 *     mai azzerare il primo) — la sospensione non verrà mai revocata, quindi
 *     la riga resterebbe RICHIESTO per sempre.
 *  4. La liquidazione di cessazione (clausola 12.4: "il saldo residuo è
 *     liquidato integralmente") chiama `eseguiPayoutImmediato(w.id,
 *     { ignoraSoglia: true })`. `ignoraSoglia` salta i guard su
 *     sospensione/visura ma NON il controllo anti-doppio-payout dentro la
 *     transazione di reserve (payout-exec.ts:269-273, che impedisce di
 *     svuotare due volte lo stesso wallet e NON va reso condizionale): trova
 *     la riga RICHIESTO ancora in-flight e rifiuta l'intero wallet con
 *     "Payout già in corso, attendi".
 *  5. Il chiamante è best-effort (`.catch(() => undefined)`): l'esito negativo
 *     spariva senza log né notifica.
 *
 * Fix: PRIMA del ciclo di liquidazione esistente, `deleteCompanyAction` salda
 * le righe RICHIESTO residue riusando `settlePayout` — lo stesso motore
 * usato da `processPayouts` per queste righe, nessuna reimplementazione della
 * logica di settlement. Questo libera il lock anti-doppione per il ciclo
 * esistente, che liquida correttamente il RESTO del saldo (il settlement
 * della riga residua decrementa già il wallet).
 *
 * Questo file copre l'orchestrazione con `@/lib/wallet/payout-exec` mockato
 * (query giusta, ordine, esclusione IN_LAVORAZIONE, skip sul debito,
 * controprova senza residui). La prova che il lock anti-doppione smette
 * DAVVERO di scattare — con `eseguiPayoutImmediato`/`settlePayout` reali — è
 * in `suspension-actions.saldo-residuo-integrazione.test.ts`.
 */

const COMPANY_ID = 'company-1';
const RAGIONE_SOCIALE = 'Test SRL';

const { authMock, prismaMock, redirectMock, eseguiPayoutImmediatoMock, settlePayoutMock } = vi.hoisted(
  () => ({
    authMock: vi.fn(),
    prismaMock: {
      company: { findUnique: vi.fn(), update: vi.fn() },
      wallet: { findMany: vi.fn(), findFirst: vi.fn() },
      payout: { findMany: vi.fn(), update: vi.fn() },
      user: { updateMany: vi.fn() },
      $transaction: vi.fn((ops: unknown[]) => Promise.all(ops)),
    },
    redirectMock: vi.fn((url: string) => {
      throw new Error(`__REDIRECT__:${url}`);
    }),
    eseguiPayoutImmediatoMock: vi.fn(),
    settlePayoutMock: vi.fn(),
  }),
);

vi.mock('@pv/db', () => ({ prisma: prismaMock }));
vi.mock('@/auth', () => ({ auth: authMock }));
vi.mock('next/navigation', () => ({ redirect: redirectMock }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/notifiche', () => ({ sendNotification: vi.fn(() => Promise.resolve()) }));
vi.mock('@/lib/wallet/payout-exec', () => ({
  eseguiPayoutImmediato: eseguiPayoutImmediatoMock,
  settlePayout: settlePayoutMock,
}));

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
  prismaMock.wallet.findFirst.mockResolvedValue(null); // nessun debito di default
  prismaMock.wallet.findMany.mockResolvedValue([]);
  prismaMock.payout.findMany.mockResolvedValue([]);
  prismaMock.payout.update.mockResolvedValue({});
  prismaMock.company.update.mockResolvedValue({});
  prismaMock.user.updateMany.mockResolvedValue({ count: 0 });
  eseguiPayoutImmediatoMock.mockResolvedValue({ ok: true, payoutId: 'p-resto', importoCent: 1 });
  settlePayoutMock.mockResolvedValue({ ok: true, payoutId: 'p-residuo', importoCent: 48_000 });
});

describe('deleteCompanyAction — righe RICHIESTO residue prima della liquidazione (clausola 12.4)', () => {
  it('wallet con una riga RICHIESTO residua: viene saldata via settlePayout (stesso motore di processPayouts)', async () => {
    prismaMock.payout.findMany.mockResolvedValue([{ id: 'payout-richiesto', walletId: 'wallet-1' }]);
    prismaMock.wallet.findMany.mockResolvedValue([{ id: 'wallet-1' }]);

    const res = await deleteCompanyAction(COMPANY_ID, RAGIONE_SOCIALE);

    expect(res).toEqual({ ok: true });
    // Interroga SOLO le righe RICHIESTO (mai IN_LAVORAZIONE) di questa
    // azienda (madre o sedi) — non di altre.
    expect(prismaMock.payout.findMany).toHaveBeenCalledWith({
      where: {
        stato: 'RICHIESTO',
        wallet: { OR: [{ companyId: COMPANY_ID }, { sede: { companyId: COMPANY_ID } }] },
      },
      select: { id: true, walletId: true },
    });
    // Stesso "lock" morbido di processPayouts: transizione a IN_LAVORAZIONE
    // prima di chiamare settlePayout.
    expect(prismaMock.payout.update).toHaveBeenCalledWith({
      where: { id: 'payout-richiesto' },
      data: { stato: 'IN_LAVORAZIONE' },
    });
    expect(settlePayoutMock).toHaveBeenCalledWith('payout-richiesto');
    // La liquidazione del RESTO del saldo (ciclo esistente) viene comunque
    // tentata: non si blocca più a causa della riga residua.
    expect(eseguiPayoutImmediatoMock).toHaveBeenCalledWith('wallet-1', { ignoraSoglia: true });
  });

  it('ordine: la riga residua si salda PRIMA che parta il ciclo di liquidazione del resto', async () => {
    const callOrder: string[] = [];
    prismaMock.payout.findMany.mockResolvedValue([{ id: 'payout-richiesto', walletId: 'wallet-1' }]);
    prismaMock.wallet.findMany.mockImplementation(() => {
      callOrder.push('wallet.findMany');
      return Promise.resolve([{ id: 'wallet-1' }]);
    });
    settlePayoutMock.mockImplementation((id: string) => {
      callOrder.push(`settlePayout:${id}`);
      return Promise.resolve({ ok: true, payoutId: id, importoCent: 1 });
    });
    eseguiPayoutImmediatoMock.mockImplementation((walletId: string) => {
      callOrder.push(`eseguiPayoutImmediato:${walletId}`);
      return Promise.resolve({ ok: true, payoutId: 'p', importoCent: 1 });
    });

    await deleteCompanyAction(COMPANY_ID, RAGIONE_SOCIALE);

    expect(callOrder).toEqual([
      'settlePayout:payout-richiesto',
      'wallet.findMany',
      'eseguiPayoutImmediato:wallet-1',
    ]);
  });

  it('riga IN_LAVORAZIONE: NON viene toccata — un settlement è già davvero in corso, risaldarla rischierebbe un doppio pagamento', async () => {
    // La query filtra esplicitamente `stato: 'RICHIESTO'`: una riga
    // IN_LAVORAZIONE non comparirebbe mai nel risultato reale. Il mock
    // simula esattamente questo (nessuna riga restituita).
    prismaMock.payout.findMany.mockResolvedValue([]);
    prismaMock.wallet.findMany.mockResolvedValue([{ id: 'wallet-1' }]);

    await deleteCompanyAction(COMPANY_ID, RAGIONE_SOCIALE);

    expect(settlePayoutMock).not.toHaveBeenCalled();
    // Blocca la deriva: se qualcuno allargasse il filtro a IN_LAVORAZIONE
    // per "sicurezza", questa assert fallisce.
    expect(prismaMock.payout.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ stato: 'RICHIESTO' }) }),
    );
  });

  it('controprova non tautologica: azienda SENZA righe residue viene liquidata come prima, settlePayout mai chiamata', async () => {
    prismaMock.payout.findMany.mockResolvedValue([]);
    prismaMock.wallet.findMany.mockResolvedValue([{ id: 'wallet-madre' }, { id: 'wallet-sede' }]);

    const res = await deleteCompanyAction(COMPANY_ID, RAGIONE_SOCIALE);

    expect(res).toEqual({ ok: true });
    expect(settlePayoutMock).not.toHaveBeenCalled();
    expect(prismaMock.payout.update).not.toHaveBeenCalled();
    expect(eseguiPayoutImmediatoMock).toHaveBeenCalledTimes(2);
    expect(eseguiPayoutImmediatoMock).toHaveBeenNthCalledWith(1, 'wallet-madre', { ignoraSoglia: true });
    expect(eseguiPayoutImmediatoMock).toHaveBeenNthCalledWith(2, 'wallet-sede', { ignoraSoglia: true });
  });

  it('caso saldo negativo (debito): nessuna query sulle righe residue, nessuna riga saldata, nessun payout — la clausola 12.4 richiede prima la regolarizzazione', async () => {
    prismaMock.wallet.findFirst.mockResolvedValue({ id: 'wallet-sede-a' }); // debito rilevato
    // Anche se esistesse una riga RICHIESTO residua, non deve nemmeno essere
    // cercata: il ramo `if (!debito)` non viene mai raggiunto.
    prismaMock.payout.findMany.mockResolvedValue([{ id: 'payout-richiesto', walletId: 'wallet-1' }]);

    const res = await deleteCompanyAction(COMPANY_ID, RAGIONE_SOCIALE);

    expect(res).toEqual({ ok: true });
    expect(prismaMock.payout.findMany).not.toHaveBeenCalled();
    expect(settlePayoutMock).not.toHaveBeenCalled();
    expect(eseguiPayoutImmediatoMock).not.toHaveBeenCalled();
  });

  it('best-effort: settlePayout su una riga residua che rigetta NON blocca né la liquidazione del resto né la cancellazione, ma logga in modo diagnosticabile', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    prismaMock.payout.findMany.mockResolvedValue([{ id: 'payout-richiesto', walletId: 'wallet-1' }]);
    prismaMock.wallet.findMany.mockResolvedValue([{ id: 'wallet-1' }]);
    settlePayoutMock.mockRejectedValue(new Error('provider down'));

    const res = await deleteCompanyAction(COMPANY_ID, RAGIONE_SOCIALE);

    expect(res).toEqual({ ok: true });
    // La liquidazione del resto viene comunque tentata.
    expect(eseguiPayoutImmediatoMock).toHaveBeenCalledWith('wallet-1', { ignoraSoglia: true });
    // Il fallimento è diagnosticabile: menziona l'id del payout/wallet coinvolto.
    expect(consoleErrorSpy).toHaveBeenCalled();
    const logged = consoleErrorSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(logged).toMatch(/payout-richiesto/);
    consoleErrorSpy.mockRestore();
  });

  it('best-effort: eseguiPayoutImmediato che ritorna { ok:false } (es. "Payout già in corso") NON blocca la cancellazione ma logga il wallet e l\'errore in modo esplicito', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    prismaMock.wallet.findMany.mockResolvedValue([{ id: 'wallet-1' }]);
    eseguiPayoutImmediatoMock.mockResolvedValue({ ok: false, error: 'Payout già in corso, attendi' });

    const res = await deleteCompanyAction(COMPANY_ID, RAGIONE_SOCIALE);

    expect(res).toEqual({ ok: true });
    expect(consoleErrorSpy).toHaveBeenCalled();
    const logged = consoleErrorSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(logged).toMatch(/wallet-1/);
    expect(logged).toMatch(/Payout già in corso/);
    consoleErrorSpy.mockRestore();
  });
});
