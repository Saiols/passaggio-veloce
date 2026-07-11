import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Cablaggio wallet↔sede in `confermaAnnullamentoConPenaleAction`.
 *
 * `walletBrokerDellaPratica` (wallet-pratica.ts) è testato in isolamento: gli si
 * passano oggetti letterali `{ brokerId, brokerSedeId }` e si verifica che scelga
 * sede o madre. Ma il bug reale (titolare e operatore della stessa sede vedevano
 * saldi diversi, e la penale spariva all'operatore) non stava nell'helper: stava
 * nel fatto che l'azione lo invocasse con la `pratica` vera caricata dalla sua
 * transazione, e ne usasse davvero il wallet risolto per storno e penale. Questo
 * test esercita `confermaAnnullamentoConPenaleAction` con Prisma mockato e
 * verifica gli ARGOMENTI delle chiamate a `wallet.upsert` / `transazioneWallet.*`
 * / `wallet.update`, non solo l'esito: un mock restituisce il suo valore
 * preconfezionato qualunque cosa gli passi, quindi asserire solo `{ ok: true }`
 * non avrebbe protetto dalla regressione — il codice tornava `{ ok: true }`
 * anche quando risolveva (o creava) il wallet sbagliato.
 */

const { prismaMock, txMock, authMock, redirectMock, destinatariAgenziaMock } = vi.hoisted(() => {
  const txMock = {
    pratica: { findUnique: vi.fn(), update: vi.fn() },
    wallet: { upsert: vi.fn(), update: vi.fn() },
    transazioneWallet: { findFirst: vi.fn(), create: vi.fn() },
    feeAddebito: { updateMany: vi.fn() },
    praticaAssegnazione: { updateMany: vi.fn() },
  };
  return {
    txMock,
    prismaMock: {
      $transaction: vi.fn((cb: (tx: typeof txMock) => unknown) => cb(txMock)),
    },
    authMock: vi.fn(),
    redirectMock: vi.fn((url: string) => {
      throw new Error(`__REDIRECT__:${url}`);
    }),
    destinatariAgenziaMock: vi.fn(() => Promise.resolve([])),
  };
});

vi.mock('@pv/db', () => ({ prisma: prismaMock }));
vi.mock('@/auth', () => ({ auth: authMock }));
vi.mock('next/navigation', () => ({ redirect: redirectMock }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/notifiche', () => ({
  sendNotification: vi.fn(() => Promise.resolve()),
  getAdminEmails: vi.fn(() => Promise.resolve([])),
  notifyClientiAvanzamento: vi.fn(() => Promise.resolve()),
}));
vi.mock('@/lib/notifiche/pratica', () => ({ destinatariAgenzia: destinatariAgenziaMock }));
vi.mock('@/lib/eventi/emit', () => ({ emitEventiPratica: vi.fn(() => Promise.resolve()) }));
vi.mock('@/lib/eventi/pratica-eventi', () => ({ eventoPraticaPenale: vi.fn(() => ({})) }));

import { confermaAnnullamentoConPenaleAction } from './segnalazione';
import { motivoPenaleSegnalazione } from '@/lib/pratiche/stato-extra';
import { PENALI } from './config';

const PID = '33333333-3333-4333-8333-333333333333';
const BROKER_ID = 'broker-1';
const SEDE_BROKER = 'sede-broker-1';
const AGENZIA_ID = 'ag-1';
const SEDE_AGENZIA = 'sede-agenzia-1';

/** Pratica come la carica `confermaAnnullamentoConPenaleAction` dentro la sua transazione. */
function praticaFixture(over: Record<string, unknown> = {}) {
  return {
    id: PID,
    stato: 'ACCETTATA',
    flagSegnalata: true,
    segnalazioneStato: 'RICEVUTA',
    tipoSegnalazione: 'FERMO_AMMINISTRATIVO',
    codicePratica: 'PV-42',
    brokerId: BROKER_ID,
    brokerSedeId: SEDE_BROKER,
    agenziaAssegnataId: AGENZIA_ID,
    agenziaSedeId: SEDE_AGENZIA,
    veicoli: [{ targa: 'AA000AA', segnalato: true }],
    broker: {
      ragioneSociale: 'Broker SRL',
      email: 'broker@example.com',
      wallet: null,
      users: [{ id: 'u-broker', email: 'admin@broker.it', nome: 'Mario' }],
    },
    agenziaAssegnata: {
      ragioneSociale: 'Agenzia SRL',
      users: [],
    },
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  authMock.mockResolvedValue({ user: { id: 'admin-1', role: 'ADMIN_PIATTAFORMA' } });
  destinatariAgenziaMock.mockResolvedValue([]);
  txMock.pratica.findUnique.mockResolvedValue(praticaFixture());
  txMock.pratica.update.mockResolvedValue({});
  txMock.wallet.upsert.mockResolvedValue({ id: 'wallet-sede-1', saldoCent: 0 });
  txMock.wallet.update.mockResolvedValue({});
  txMock.transazioneWallet.findFirst.mockResolvedValue(null);
  txMock.transazioneWallet.create.mockResolvedValue({});
  txMock.feeAddebito.updateMany.mockResolvedValue({ count: 0 });
  txMock.praticaAssegnazione.updateMany.mockResolvedValue({ count: 0 });
});

describe('confermaAnnullamentoConPenaleAction — cablaggio wallet di sede', () => {
  it('pratica con brokerSedeId: risolve il wallet della SEDE (mai quello della madre) e vi addebita la penale', async () => {
    txMock.pratica.findUnique.mockResolvedValue(praticaFixture({ brokerSedeId: SEDE_BROKER }));
    txMock.wallet.upsert.mockResolvedValue({ id: 'wallet-sede-1', saldoCent: 0 });

    const res = await confermaAnnullamentoConPenaleAction(PID);

    expect(res).toEqual({ ok: true });
    expect(txMock.wallet.upsert).toHaveBeenCalledTimes(1);
    expect(txMock.wallet.upsert).toHaveBeenCalledWith({
      where: { sedeId: SEDE_BROKER },
      update: {},
      create: { sedeId: SEDE_BROKER, saldoCent: 0 },
      select: { id: true, saldoCent: true },
    });
    // La penale deve finire sul wallet appena risolto (quello della sede), non
    // su un wallet risolto per companyId.
    expect(txMock.transazioneWallet.create).toHaveBeenCalledWith({
      data: {
        walletId: 'wallet-sede-1',
        tipo: 'PENALE_BROKER',
        importoCent: -PENALI.PENALE_BROKER_DEFAULT_CENT,
        saldoPostCent: -PENALI.PENALE_BROKER_DEFAULT_CENT,
        praticaId: PID,
        note: motivoPenaleSegnalazione('FERMO_AMMINISTRATIVO'),
      },
    });
    expect(txMock.wallet.update).toHaveBeenCalledWith({
      where: { id: 'wallet-sede-1' },
      data: { saldoCent: -PENALI.PENALE_BROKER_DEFAULT_CENT },
    });
  });

  it('pratica legacy senza brokerSedeId: ricade sul wallet della madre (where: companyId)', async () => {
    txMock.pratica.findUnique.mockResolvedValue(praticaFixture({ brokerSedeId: null }));
    txMock.wallet.upsert.mockResolvedValue({ id: 'wallet-madre-1', saldoCent: 0 });

    const res = await confermaAnnullamentoConPenaleAction(PID);

    expect(res).toEqual({ ok: true });
    expect(txMock.wallet.upsert).toHaveBeenCalledTimes(1);
    expect(txMock.wallet.upsert).toHaveBeenCalledWith({
      where: { companyId: BROKER_ID },
      update: {},
      create: { companyId: BROKER_ID, saldoCent: 0 },
      select: { id: true, saldoCent: true },
    });
    expect(txMock.transazioneWallet.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ walletId: 'wallet-madre-1' }) }),
    );
  });

  it('storno: trova il CREDITO_PRATICA sul wallet risolto (sede) e lo storna prima di addebitare la penale', async () => {
    txMock.pratica.findUnique.mockResolvedValue(praticaFixture({ brokerSedeId: SEDE_BROKER }));
    txMock.wallet.upsert.mockResolvedValue({ id: 'wallet-sede-1', saldoCent: 10_000 });
    // Credito pratica di €50 già accreditato sul wallet di sede (edge case difensivo).
    txMock.transazioneWallet.findFirst.mockResolvedValue({ id: 'tw-credito-1', importoCent: 5_000 });

    const res = await confermaAnnullamentoConPenaleAction(PID);

    expect(res).toEqual({ ok: true });
    // La ricerca del credito da stornare deve avvenire sul wallet GIUSTO
    // (quello di sede appena risolto), non su un wallet risolto per companyId:
    // è esattamente il ramo che prima moriva silenzioso.
    expect(txMock.transazioneWallet.findFirst).toHaveBeenCalledWith({
      where: { walletId: 'wallet-sede-1', praticaId: PID, tipo: 'CREDITO_PRATICA' },
    });
    // Storno: saldo 10_000 - 5_000 = 5_000, stesso wallet.
    expect(txMock.transazioneWallet.create).toHaveBeenNthCalledWith(1, {
      data: {
        walletId: 'wallet-sede-1',
        tipo: 'STORNO',
        importoCent: -5_000,
        saldoPostCent: 5_000,
        praticaId: PID,
      },
    });
    // Penale applicata DOPO lo storno, sullo stesso wallet: 5_000 - 2_500 = 2_500.
    expect(txMock.transazioneWallet.create).toHaveBeenNthCalledWith(2, {
      data: {
        walletId: 'wallet-sede-1',
        tipo: 'PENALE_BROKER',
        importoCent: -PENALI.PENALE_BROKER_DEFAULT_CENT,
        saldoPostCent: 5_000 - PENALI.PENALE_BROKER_DEFAULT_CENT,
        praticaId: PID,
        note: motivoPenaleSegnalazione('FERMO_AMMINISTRATIVO'),
      },
    });
    // Il saldo finale persistito riflette sia lo storno sia la penale.
    expect(txMock.wallet.update).toHaveBeenCalledWith({
      where: { id: 'wallet-sede-1' },
      data: { saldoCent: 5_000 - PENALI.PENALE_BROKER_DEFAULT_CENT },
    });
  });
});

describe('confermaAnnullamentoConPenaleAction — penale per veicolo segnalato', () => {
  it('3 veicoli, 2 segnalati → penale = 2 × €25 (i veicoli sani non si pagano)', async () => {
    txMock.pratica.findUnique.mockResolvedValue(
      praticaFixture({
        veicoli: [
          { targa: 'AA000AA', segnalato: true },
          { targa: 'BB111BB', segnalato: true },
          { targa: 'CC222CC', segnalato: false },
        ],
      }),
    );
    txMock.wallet.upsert.mockResolvedValue({ id: 'w-1', saldoCent: 0 });

    const res = await confermaAnnullamentoConPenaleAction(PID);
    expect(res).toEqual({ ok: true });

    const atteso = 2 * PENALI.PENALE_BROKER_DEFAULT_CENT;
    expect(txMock.transazioneWallet.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tipo: 'PENALE_BROKER',
          importoCent: -atteso,
          saldoPostCent: -atteso,
        }),
      }),
    );
    expect(txMock.pratica.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ penaleAddebitatoCent: atteso }),
      }),
    );
  });

  it('nessun veicolo segnalato (dati legacy) → fallback su 1 veicolo, mai 0', async () => {
    txMock.pratica.findUnique.mockResolvedValue(
      praticaFixture({
        veicoli: [
          { targa: 'AA000AA', segnalato: false },
          { targa: 'BB111BB', segnalato: false },
        ],
      }),
    );
    txMock.wallet.upsert.mockResolvedValue({ id: 'w-1', saldoCent: 0 });

    const res = await confermaAnnullamentoConPenaleAction(PID);
    expect(res).toEqual({ ok: true });

    // Mai 0 (non addebiteremmo nulla), mai 2 (addebiteremmo veicoli sani).
    expect(txMock.pratica.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          penaleAddebitatoCent: PENALI.PENALE_BROKER_DEFAULT_CENT,
        }),
      }),
    );
  });
});
