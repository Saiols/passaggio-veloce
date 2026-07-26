import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  prismaMock,
  txMock,
  getPaymentMock,
  executePayoutMock,
  createDocBrokerMock,
  createGiustificativoPromoMock,
  visuraScadutaMock,
} = vi.hoisted(() => {
  const txMock = {
    $queryRaw: vi.fn(),
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
    createGiustificativoPromoMock: vi.fn(),
    visuraScadutaMock: vi.fn(),
    prismaMock: {
      $transaction: vi.fn((cb: (tx: typeof txMock) => unknown) => cb(txMock)),
      payout: { findUnique: vi.fn(), update: vi.fn() },
      wallet: { findUnique: vi.fn() },
    },
  };
});

vi.mock('server-only', () => ({}));
vi.mock('@pv/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/fatturazione/engine', () => ({ createDocBroker: createDocBrokerMock }));
vi.mock('@/lib/fatturazione/giustificativo-promo', () => ({
  createGiustificativoPromo: createGiustificativoPromoMock,
}));
vi.mock('@/lib/providers/payment', () => ({ getPayment: getPaymentMock }));
vi.mock('@/lib/visura/stato', () => ({ isVisuraScadutaCompany: visuraScadutaMock }));

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
  // guard visura (clausola 8), fuori transazione: azienda risolvibile e mai
  // scaduta di default, così i test preesistenti restano invariati.
  prismaMock.wallet.findUnique.mockResolvedValue({
    companyId: 'company-1',
    sede: null,
  });
  visuraScadutaMock.mockResolvedValue(false);
  // reserve (transazione): il row lock FOR UPDATE è un no-op nel mock.
  txMock.$queryRaw.mockResolvedValue([{ id: 'w1' }]);
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
  createGiustificativoPromoMock.mockResolvedValue(undefined);
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

  it('la reserve prende un row lock FOR UPDATE sul wallet (serializza le reserve concorrenti)', async () => {
    txMock.wallet.findUnique.mockResolvedValue({ id: 'w1', saldoCent: 80_000 });

    await eseguiPayoutImmediato('w1');

    // Il lock è emesso, parametrizzato sul walletId e verso la tabella wallets.
    expect(txMock.$queryRaw).toHaveBeenCalledTimes(1);
    const [strings, id] = txMock.$queryRaw.mock.calls[0] as [string[], string];
    expect(strings.join('')).toMatch(/FOR UPDATE/);
    expect(strings.join('')).toMatch(/"wallets"/);
    expect(id).toBe('w1');
    // Deve precedere la lettura del wallet (e quindi il create del payout): è il
    // lock a serializzare, non la findUnique.
    const lockOrder = txMock.$queryRaw.mock.invocationCallOrder[0];
    const findOrder = txMock.wallet.findUnique.mock.invocationCallOrder[0];
    expect(lockOrder).toBeLessThan(findOrder);
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
    expect(createGiustificativoPromoMock).toHaveBeenCalledWith({ payoutId: 'p1' });
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
    expect(createGiustificativoPromoMock).not.toHaveBeenCalled();
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
    expect(createGiustificativoPromoMock).not.toHaveBeenCalled();
  });

  it('payout automatico → tipo movimento PAYOUT_AUTOMATICO', async () => {
    txMock.wallet.findUnique.mockResolvedValue({ id: 'w1', saldoCent: 80_000 });
    prismaMock.payout.findUnique.mockResolvedValue(payoutSede({ automatico: true }));

    await eseguiPayoutImmediato('w1', { automatico: true });

    expect(txMock.transazioneWallet.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ tipo: 'PAYOUT_AUTOMATICO' }) }),
    );
  });

  it('aggancia anche il CREDITO_PROMO al payout (per il giustificativo interno)', async () => {
    txMock.wallet.findUnique.mockResolvedValue({ id: 'w1', saldoCent: 80_000 });
    await eseguiPayoutImmediato('w1');
    const call = txMock.transazioneWallet.updateMany.mock.calls[0][0];
    expect(call.where.tipo.in).toEqual(
      expect.arrayContaining(['CREDITO_PRATICA', 'CREDITO_AFFILIAZIONE', 'CREDITO_PROMO']),
    );
  });
});

/**
 * Clausola 5 dei Termini, documento v8 (2026-07-26): «Gli altri wallet
 * dell'Utente (altre sedi e wallet di affiliazione) non sono in alcun modo
 * vincolati o bloccati per effetto del saldo negativo di un singolo wallet.»
 *
 * Fino a quella data il codice faceva l'OPPOSTO, e questi stessi test lo
 * inchiodavano: `hasNegativeCompanyWallet` dentro la reserve sospendeva ogni
 * payout dell'azienda finché un wallet qualsiasi era in rosso. Il documento ha
 * riscritto la regola, quindi il guard è stato rimosso e i test sono stati
 * girati: quello che prima era il bug (pagare l'affiliazione mentre la sede è
 * in penale) ora È il comportamento contrattuale.
 *
 * Il blocco per-wallet resta, e non ha bisogno di alcuna query sugli altri:
 * lo impone il saldo del wallet stesso. Il debito non sparisce — si compensa
 * con i compensi successivi su quel wallet, e alla cessazione del rapporto
 * torna a bloccare l'intera liquidazione (`hasNegativeCompanyWallet` è ancora
 * chiamata da `deleteCompanyAction`, clausole 5 ultimo comma e 12.4).
 */
describe('eseguiPayoutImmediato — il saldo negativo blocca SOLO il proprio wallet (clausola 5)', () => {
  it("un altro wallet della stessa azienda è in rosso → questo wallet incassa comunque", async () => {
    txMock.wallet.findUnique.mockResolvedValue({
      id: 'w1',
      saldoCent: 80_000,
      companyId: null,
      sedeId: 'sede-1',
      sede: { companyId: 'company-1' },
    });
    // Esiste davvero un wallet negativo nell'azienda: se il guard aziendale
    // tornasse, questo mock lo farebbe scattare e il test tornerebbe rosso.
    txMock.wallet.findFirst.mockResolvedValue({ id: 'w-negativo' });

    const r = await eseguiPayoutImmediato('w1');

    expect(r.ok).toBe(true);
    expect(txMock.payout.create).toHaveBeenCalled();
  });

  it('nessuna interrogazione sugli altri wallet dell\'azienda: il confine è il singolo wallet', async () => {
    txMock.wallet.findUnique.mockResolvedValue({
      id: 'w1',
      saldoCent: 80_000,
      companyId: null,
      sedeId: 'sede-1',
      sede: { companyId: 'company-1' },
    });

    await eseguiPayoutImmediato('w1');

    expect(txMock.wallet.findFirst).not.toHaveBeenCalled();
  });

  it('il wallet richiesto è a saldo negativo → rifiutato, non si bonifica un debito', async () => {
    txMock.wallet.findUnique.mockResolvedValue({
      id: 'w1',
      saldoCent: -2_500, // penale da €25 su wallet vuoto (clausola 10.4)
      companyId: null,
      sedeId: 'sede-1',
      sede: { companyId: 'company-1' },
    });

    const r = await eseguiPayoutImmediato('w1');

    expect(r).toEqual({ ok: false, error: 'Saldo non erogabile' });
    expect(txMock.payout.create).not.toHaveBeenCalled();
    expect(executePayoutMock).not.toHaveBeenCalled();
  });

  it('nemmeno la liquidazione di cessazione (ignoraSoglia) bonifica un wallet in rosso', async () => {
    txMock.wallet.findUnique.mockResolvedValue({ id: 'w1', saldoCent: -2_500 });

    const r = await eseguiPayoutImmediato('w1', { ignoraSoglia: true });

    expect(r).toEqual({ ok: false, error: 'Saldo non erogabile' });
    expect(txMock.payout.create).not.toHaveBeenCalled();
  });

  it("liquidazione alla cessazione (ignoraSoglia): residuo positivo sotto soglia erogato comunque", async () => {
    txMock.wallet.findUnique.mockResolvedValue({
      id: 'w1',
      saldoCent: 30_000, // sotto soglia 500€: ammesso solo perché ignoraSoglia
      companyId: null,
      sedeId: 'sede-1',
      sede: { companyId: 'company-1' },
    });

    const r = await eseguiPayoutImmediato('w1', { ignoraSoglia: true });

    expect(r.ok).toBe(true);
    expect(txMock.payout.create).toHaveBeenCalled();
  });
});

/**
 * Ciclo di vita visura camerale (clausola 8 dei Termini): senza una visura
 * aggiornata PV non può fatturare correttamente (anche il documento broker
 * conto terzi, clausola 6), quindi i payout restano sospesi finché l'azienda
 * non la aggiorna (via /visura, non un vicolo cieco). Per il broker questa è
 * l'UNICA conseguenza; per l'agenzia si somma al blocco operativo (altrove).
 * `isVisuraScadutaCompany` usa `prisma`, non `tx`: il guard vive PRIMA di
 * aprire la transazione di reserve.
 */
describe('eseguiPayoutImmediato — guard visura scaduta (clausola 8)', () => {
  it('visura scaduta → payout rifiutato, nessun Payout creato', async () => {
    visuraScadutaMock.mockResolvedValue(true);
    txMock.wallet.findUnique.mockResolvedValue({ id: 'w1', saldoCent: 80_000 });

    const r = await eseguiPayoutImmediato('w1');

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/visura/i);
    expect(visuraScadutaMock).toHaveBeenCalledWith('company-1');
    expect(txMock.payout.create).not.toHaveBeenCalled();
    expect(executePayoutMock).not.toHaveBeenCalled();
  });

  it('visura valida → payout procede', async () => {
    visuraScadutaMock.mockResolvedValue(false);
    txMock.wallet.findUnique.mockResolvedValue({ id: 'w1', saldoCent: 80_000 });

    const r = await eseguiPayoutImmediato('w1');

    expect(r.ok).toBe(true);
    expect(txMock.payout.create).toHaveBeenCalled();
  });

  it("wallet senza company risolvibile (non trovato) → guard visura saltato, gestito dal check 'wallet non trovato' della transazione", async () => {
    prismaMock.wallet.findUnique.mockResolvedValue(null);
    txMock.wallet.findUnique.mockResolvedValue(null);

    const r = await eseguiPayoutImmediato('w1');

    expect(r).toEqual({ ok: false, error: 'Wallet non trovato' });
    expect(visuraScadutaMock).not.toHaveBeenCalled();
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
