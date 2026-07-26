import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Gate del ramo ADMIN nel MOTORE (`firmaPraticaCore`), non nella server action.
 *
 * `app/admin/pratiche/actions.ts` (`attestaFirmaAdminAction`) ha già un gate
 * `isAdminPiattaforma` e un test mockato (`actions.test.ts`) che lo verifica —
 * ma quel test mocka `firmaPraticaCore`, quindi non dimostra nulla sul motore
 * reale. Il motore è la difesa in profondità: l'ASSISTENTE (staff interno
 * senza leve finanziarie, decisione D-02) non deve MAI poter far scattare un
 * addebito SEPA all'agenzia, un credito wallet al broker o una fattura, a
 * prescindere da eventuali bug futuri nel chiamante.
 *
 * Stile di mock identico a `app/pratiche/actions.authz.test.ts`, che importa
 * la stessa catena (`actions.ts` → `firma-engine.ts`).
 */

const { prismaMock, authMock, getSessionContextMock, redirectMock, visuraScadutaMock } = vi.hoisted(() => ({
  prismaMock: {
    pratica: { findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    feeAddebito: { create: vi.fn() },
    praticaStatoLog: { create: vi.fn() },
    wallet: { upsert: vi.fn(), update: vi.fn() },
    transazioneWallet: { create: vi.fn() },
    $transaction: vi.fn(async (cb: (t: unknown) => unknown) => cb(prismaMock)),
  },
  authMock: vi.fn(),
  getSessionContextMock: vi.fn(),
  redirectMock: vi.fn((url: string) => {
    throw new Error(`__REDIRECT__:${url}`);
  }),
  visuraScadutaMock: vi.fn(),
}));

vi.mock('@pv/db', () => ({ prisma: prismaMock }));
vi.mock('@/auth', () => ({ auth: authMock }));
vi.mock('@/lib/auth/session-context', async (orig) => {
  const actual = (await orig()) as object;
  return { ...actual, getSessionContext: getSessionContextMock };
});
vi.mock('next/navigation', () => ({ redirect: redirectMock }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

// Effetti collaterali del percorso "happy path" (mai raggiunti nei test di
// deny; neutralizzati per non dipendere da wallet, fatture, email e CRM).
vi.mock('@/lib/fee/blocco', () => ({ isAgenziaBloccata: vi.fn(() => Promise.resolve(false)) }));
vi.mock('@/lib/visura/stato', () => ({ isVisuraScadutaCompany: visuraScadutaMock }));
vi.mock('@/lib/notifiche', () => ({
  sendNotification: vi.fn(() => Promise.resolve()),
  notifyClientiAvanzamento: vi.fn(() => Promise.resolve()),
}));
vi.mock('@/lib/notifiche/pratica', () => ({
  destinatariBroker: vi.fn(() => Promise.resolve([])),
}));
vi.mock('@/lib/affiliazione/accredit', () => ({
  accreditCommissioniAffiliazione: vi.fn(() => Promise.resolve({ accrediti: [] })),
}));
vi.mock('@/lib/affiliazione/notifications', () => ({
  notifyReferralFirstPratica: vi.fn(() => Promise.resolve()),
  notifyPayoutThresholdCrossed: vi.fn(() => Promise.resolve()),
}));
vi.mock('@/lib/crm/sync', () => ({ onPraticaFirmata: vi.fn(() => Promise.resolve()) }));
vi.mock('@/lib/fatturazione/engine', () => ({ createFatturaPv: vi.fn(() => Promise.resolve(null)) }));
vi.mock('@/lib/fatturazione/documento-pdf', () => ({
  fatturaPvAttachment: vi.fn(() => Promise.resolve(null)),
}));
vi.mock('@/lib/wallet/auto-payout', () => ({
  autoPayoutBrokerDopoFirma: vi.fn(() => Promise.resolve()),
}));
vi.mock('@/lib/eventi/emit', () => ({ emitEventoPratica: vi.fn(() => Promise.resolve()) }));
vi.mock('@/lib/eventi/pratica-eventi', () => ({
  eventoPraticaFirmata: vi.fn(() => ({})),
}));

import { firmaPraticaCore } from './firma-engine';

const PID = 'pratica-1';
const MOTIVO = 'Confermato per telefono col cliente, agenzia irreperibile';

/** Pratica valida per il percorso "happy" (superato lo stato/segnalazione/agenzia). */
const praticaValida = () => ({
  id: PID,
  stato: 'PROCESSATA',
  flagSegnalata: false,
  agenziaAssegnataId: 'agenzia-1',
  agenziaSedeId: null,
  brokerId: 'broker-1',
  brokerSedeId: null,
  // Azzerati apposta: isolano il test dai blocchi wallet/feeAddebito, che non
  // sono l'oggetto di questo file (li copre il resto della suite pratiche).
  feeAgenziaCent: 0,
  creditoBrokerCent: 0,
  broker: { referente: null, referenteSedeId: null },
  agenziaAssegnata: { referente: null, referenteSedeId: null },
});

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.$transaction.mockImplementation(async (cb: (t: unknown) => unknown) => cb(prismaMock));
  prismaMock.pratica.update.mockResolvedValue({});
  // Default: la transizione di stato (compare-and-set) trova le precondizioni
  // vere e scrive 1 riga. I test della race la sovrascrivono a { count: 0 }.
  prismaMock.pratica.updateMany.mockResolvedValue({ count: 1 });
  // Id fittizio: serve solo se il ramo feeAgenziaCent > 0 viene esercitato
  // (il motore ora si tiene l'id per passarlo a createFatturaPv).
  prismaMock.feeAddebito.create.mockResolvedValue({ id: 'fee-1' });
  // Default: visura non scaduta, mai bloccata.
  visuraScadutaMock.mockResolvedValue(false);
});

describe('firmaPraticaCore — gate ADMIN nel motore (Termini art. 11)', () => {
  it("ASSISTENTE → il motore rifiuta (redirect /dashboard), nessuna scrittura", async () => {
    authMock.mockResolvedValue({ user: { id: 'u-assistente', role: 'ASSISTENTE' } });

    await expect(
      firmaPraticaCore(PID, { tipo: 'ADMIN', motivo: MOTIVO }),
    ).rejects.toThrow(/__REDIRECT__/);

    const url = redirectMock.mock.calls.at(-1)?.[0] as string;
    expect(url).toBe('/dashboard');
    // Cruciale: rifiutare DOPO aver addebitato l'agenzia sarebbe il peggiore
    // dei mondi. Il gate deve stare prima di ogni apertura di transazione.
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    expect(prismaMock.pratica.update).not.toHaveBeenCalled();
    expect(prismaMock.pratica.updateMany).not.toHaveBeenCalled();
  });

  it('ADMIN_AZIENDA (utente di un\'azienda cliente) → rifiutato, nessuna scrittura', async () => {
    authMock.mockResolvedValue({
      user: { id: 'u-cliente', role: 'ADMIN_AZIENDA', companyId: 'c1', companyType: 'DEALER' },
    });

    await expect(
      firmaPraticaCore(PID, { tipo: 'ADMIN', motivo: MOTIVO }),
    ).rejects.toThrow(/__REDIRECT__/);

    const url = redirectMock.mock.calls.at(-1)?.[0] as string;
    expect(url).toBe('/dashboard');
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('ADMIN_PIATTAFORMA con motivo vuoto → rifiutato, nessuna scrittura', async () => {
    authMock.mockResolvedValue({ user: { id: 'admin-1', role: 'ADMIN_PIATTAFORMA' } });

    const res = await firmaPraticaCore(PID, { tipo: 'ADMIN', motivo: '' });

    expect(res).toEqual({ ok: false, error: 'La motivazione è obbligatoria' });
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('ADMIN_PIATTAFORMA con motivo di soli spazi → rifiutato, nessuna scrittura', async () => {
    authMock.mockResolvedValue({ user: { id: 'admin-1', role: 'ADMIN_PIATTAFORMA' } });

    const res = await firmaPraticaCore(PID, { tipo: 'ADMIN', motivo: '   \n  ' });

    expect(res).toEqual({ ok: false, error: 'La motivazione è obbligatoria' });
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  describe('ADMIN_PIATTAFORMA con motivo valido', () => {
    // Test "positivo": dimostra che il gate non rifiuta indiscriminatamente.
    // Senza di esso, un gate `return false` sempre (bug banale) passerebbe
    // comunque i quattro test di deny sopra.
    beforeEach(() => {
      authMock.mockResolvedValue({ user: { id: 'admin-42', role: 'ADMIN_PIATTAFORMA' } });
      prismaMock.pratica.findUnique.mockResolvedValue(praticaValida());
    });

    it('il motore procede: la transazione parte', async () => {
      const res = await firmaPraticaCore(PID, { tipo: 'ADMIN', motivo: MOTIVO });

      expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
      expect(res).toEqual({ ok: true });
    });

    it("visura scaduta dell'agenzia assegnata NON blocca l'attestazione ADMIN (guard SOLO nel ramo AGENZIA)", async () => {
      // Il guard di lib/visura/stato.ts (task 4.2) vive solo nel ramo `if
      // (attore.tipo === 'AGENZIA')`, non in questo `else`: l'admin che
      // attesta (Termini art. 11) non ha una company propria e non deve
      // essere bloccato dalla visura scaduta dell'agenzia della pratica.
      visuraScadutaMock.mockResolvedValue(true);

      const res = await firmaPraticaCore(PID, { tipo: 'ADMIN', motivo: MOTIVO });

      expect(res).toEqual({ ok: true });
      expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
    });

    it("firmaForzataDaId scritto nell'updateMany è l'id della SESSIONE, mai un valore passato dal chiamante", async () => {
      // `AttoreFirma` (tipo 'ADMIN') espone solo `motivo`, mai `userId`: è
      // impossibile per costruzione passare un autore falso. Questo test
      // documenta l'invariante e blinda che il motore legga sempre da
      // `session.user.id`, non da un campo futuro aggiunto per errore.
      await firmaPraticaCore(PID, { tipo: 'ADMIN', motivo: MOTIVO });

      expect(prismaMock.pratica.updateMany).toHaveBeenCalledTimes(1);
      const call = prismaMock.pratica.updateMany.mock.calls[0][0];
      expect(call.data.firmaForzataDaId).toBe('admin-42');
      expect(call.data.firmaForzataMotivo).toBe(MOTIVO);
      expect(call.data.stato).toBe('FIRMATA');
      // Compare-and-set: le precondizioni stanno nel WHERE, non solo nel gate
      // applicativo (`motivoBloccoFirma`) — è quello che rende la transizione
      // atomica sotto race concorrente.
      expect(call.where).toEqual({ id: PID, stato: 'PROCESSATA', flagSegnalata: false });
    });

    it('credito pratica broker → incremento wallet ATOMICO, saldoPostCent dal valore restituito dall\'UPDATE', async () => {
      // Money-integrity: il credito pratica deve usare un increment atomico
      // (no leggi-poi-scrivi), così due firme concorrenti sullo stesso wallet
      // di sede non si sovrascrivono (lost update). saldoPostCent proviene dal
      // saldo restituito dall'UPDATE, non da una somma su lettura stantia.
      prismaMock.pratica.findUnique.mockResolvedValue({
        ...praticaValida(),
        creditoBrokerCent: 5_000,
        brokerSedeId: 'sede-broker-1',
      });
      prismaMock.wallet.upsert.mockResolvedValue({ id: 'wallet-broker-1', saldoCent: 1_000 });
      prismaMock.wallet.update.mockResolvedValue({ saldoCent: 6_000 });
      prismaMock.transazioneWallet.create.mockResolvedValue({ id: 'tw-1' });

      const res = await firmaPraticaCore(PID, { tipo: 'ADMIN', motivo: MOTIVO });

      expect(res).toEqual({ ok: true });
      expect(prismaMock.wallet.update).toHaveBeenCalledWith({
        where: { id: 'wallet-broker-1' },
        data: { saldoCent: { increment: 5_000 } },
      });
      expect(prismaMock.transazioneWallet.create).toHaveBeenCalledWith({
        data: {
          walletId: 'wallet-broker-1',
          tipo: 'CREDITO_PRATICA',
          importoCent: 5_000,
          saldoPostCent: 6_000,
          praticaId: PID,
        },
      });
    });

    it('updateMany con count:0 (un\'altra transazione ha già vinto la corsa) → il motore fallisce e NON crea FeeAddebito', async () => {
      // Simula la race del FIX 1: l'admin attesta mentre l'agenzia, nello
      // stesso istante, ha già segnato "Firma avvenuta" — la SUA transazione
      // ha già portato lo stato a FIRMATA. Questa transazione trova `count: 0`
      // e deve fermarsi PRIMA di addebitare l'agenzia una seconda volta.
      prismaMock.pratica.findUnique.mockResolvedValue({
        ...praticaValida(),
        feeAgenziaCent: 5000, // >0: se il motore procedesse comunque, l'addebito sarebbe visibile
      });
      prismaMock.pratica.updateMany.mockResolvedValue({ count: 0 });

      const res = await firmaPraticaCore(PID, { tipo: 'ADMIN', motivo: MOTIVO });

      expect(res).toEqual({ ok: false, error: 'Pratica già firmata o non più firmabile' });
      expect(prismaMock.feeAddebito.create).not.toHaveBeenCalled();
    });
  });
});
