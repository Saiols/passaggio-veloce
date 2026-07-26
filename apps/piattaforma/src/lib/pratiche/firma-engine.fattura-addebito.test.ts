import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Chi emette la fattura e chi fa partire l'addebito, al variare di
 * isPaymentLive(). È il test che protegge la valvola: se sparisce, un deploy
 * con PAYMENT_PROVIDER=mock smette di produrre fatture senza che nulla lo dica.
 */

const {
  prismaMock,
  authMock,
  redirectMock,
  createFatturaPvMock,
  processFeeMock,
  isPaymentLiveMock,
  sendNotificationMock,
  fatturaPvAttachmentMock,
} = vi.hoisted(() => {
  const prismaMock = {
    pratica: { findUnique: vi.fn(), updateMany: vi.fn() },
    feeAddebito: { create: vi.fn() },
    praticaStatoLog: { create: vi.fn() },
    wallet: { upsert: vi.fn(), update: vi.fn() },
    transazioneWallet: { create: vi.fn() },
    commissioneAffiliazione: { findMany: vi.fn() },
    documentoFiscale: { updateMany: vi.fn() },
    $transaction: vi.fn(async (cb: (t: unknown) => unknown) => cb(prismaMock)),
  };
  return {
    prismaMock,
    authMock: vi.fn(),
    redirectMock: vi.fn((url: string) => {
      throw new Error(`__REDIRECT__:${url}`);
    }),
    createFatturaPvMock: vi.fn(),
    processFeeMock: vi.fn(),
    isPaymentLiveMock: vi.fn(),
    sendNotificationMock: vi.fn(),
    fatturaPvAttachmentMock: vi.fn(),
  };
});

vi.mock('@pv/db', () => ({ prisma: prismaMock }));
vi.mock('@/auth', () => ({ auth: authMock }));
vi.mock('next/navigation', () => ({ redirect: redirectMock }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/auth/permessi/guard', () => ({ requirePermesso: vi.fn(() => Promise.resolve({ ok: true })) }));
vi.mock('@/lib/auth/session-context', () => ({ getSessionContext: vi.fn(() => Promise.resolve(null)) }));
vi.mock('@/lib/auth/permissions', () => ({ isAdminPiattaforma: () => true }));
vi.mock('@/lib/fee/blocco', () => ({ isAgenziaBloccata: vi.fn(() => Promise.resolve(false)) }));
vi.mock('@/lib/visura/stato', () => ({ isVisuraScadutaCompany: vi.fn(() => Promise.resolve(false)) }));
vi.mock('@/lib/notifiche', () => ({
  sendNotification: sendNotificationMock,
  notifyClientiAvanzamento: vi.fn(() => Promise.resolve()),
}));
vi.mock('@/lib/notifiche/pratica', () => ({ destinatariBroker: vi.fn(() => Promise.resolve([])) }));
vi.mock('@/lib/affiliazione/accredit', () => ({
  accreditCommissioniAffiliazione: vi.fn(() => Promise.resolve({ accrediti: [] })),
}));
vi.mock('@/lib/affiliazione/notifications', () => ({
  notifyReferralFirstPratica: vi.fn(() => Promise.resolve()),
  notifyPayoutThresholdCrossed: vi.fn(() => Promise.resolve()),
}));
vi.mock('@/lib/crm/sync', () => ({ onPraticaFirmata: vi.fn(() => Promise.resolve()) }));
vi.mock('@/lib/fatturazione/engine', () => ({ createFatturaPv: createFatturaPvMock }));
vi.mock('@/lib/fatturazione/documento-pdf', () => ({ fatturaPvAttachment: fatturaPvAttachmentMock }));
vi.mock('@/lib/wallet/auto-payout', () => ({ autoPayoutBrokerDopoFirma: vi.fn(() => Promise.resolve()) }));
vi.mock('@/lib/eventi/emit', () => ({ emitEventoPratica: vi.fn(() => Promise.resolve()) }));
vi.mock('@/lib/eventi/pratica-eventi', () => ({ eventoPraticaFirmata: vi.fn(() => ({})) }));
vi.mock('@/lib/jobs/payment-live', () => ({ isPaymentLive: isPaymentLiveMock }));
vi.mock('@/lib/fee/process', () => ({ processFeeAddebito: processFeeMock }));

import { firmaPraticaCore } from './firma-engine';

/**
 * Lo STESSO oggetto serve due letture: il gate pre-transazione e la rilettura
 * post-commit che alimenta il blocco notifiche (N4/N31/N8). Se mancano i campi
 * della seconda — `veicoli`, `broker.users`, `agenziaAssegnata` — il blocco
 * esplode su `full.veicoli[0]` e il `catch {}` post-commit ingoia tutto: i test
 * resterebbero verdi senza aver mai raggiunto la N8.
 */
const PRATICA = {
  id: 'pr-1',
  stato: 'PROCESSATA',
  flagSegnalata: false,
  codicePratica: 'PV-0001',
  agenziaAssegnataId: 'ag-1',
  agenziaSedeId: 'sede-1',
  brokerSedeId: null,
  feeAgenziaCent: 7500,
  creditoBrokerCent: 0,
  numeroVeicoli: 1,
  tipo: 'SEMPLICE',
  brokerId: 'br-1',
  autoAddebitoAt: new Date('2026-07-26T10:00:00Z'),
  firmaForzataAt: null,
  veicoli: [],
  broker: {
    id: 'br-1',
    ragioneSociale: 'Broker Uno',
    email: 'broker@esempio.it',
    users: [],
    wallet: { saldoCent: 0 },
    referente: null,
    referenteSedeId: null,
  },
  agenziaAssegnata: {
    id: 'ag-1',
    ragioneSociale: 'Agenzia Uno',
    email: 'agenzia@esempio.it',
    users: [],
    referente: null,
    referenteSedeId: null,
  },
};

const ALLEGATO = { filename: 'fattura-3-2026.pdf', content: 'x', contentType: 'application/pdf' };

/** L'ultima chiamata a sendNotification per un dato tipo di notifica. */
function ultimaNotifica(tipo: string) {
  const calls = sendNotificationMock.mock.calls.filter((c) => c[0]?.tipo === tipo);
  return calls.at(-1);
}

beforeEach(() => {
  vi.clearAllMocks();
  authMock.mockResolvedValue({ user: { id: 'u-1', role: 'ADMIN_PIATTAFORMA' } });
  prismaMock.pratica.findUnique.mockResolvedValue(PRATICA);
  prismaMock.pratica.updateMany.mockResolvedValue({ count: 1 });
  prismaMock.praticaStatoLog.create.mockResolvedValue({});
  prismaMock.feeAddebito.create.mockResolvedValue({ id: 'fee-1' });
  prismaMock.commissioneAffiliazione.findMany.mockResolvedValue([]);
  prismaMock.documentoFiscale.updateMany.mockResolvedValue({ count: 1 });
  createFatturaPvMock.mockResolvedValue({ id: 'doc-1' });
  processFeeMock.mockResolvedValue('SUCCESS');
  sendNotificationMock.mockResolvedValue(undefined);
  fatturaPvAttachmentMock.mockResolvedValue(ALLEGATO);
});

describe('emissione fattura alla firma', () => {
  it('provider live: la firma NON emette la fattura (la emette l’incasso)', async () => {
    isPaymentLiveMock.mockReturnValue(true);
    await firmaPraticaCore('pr-1', { tipo: 'ADMIN', motivo: 'attestazione di test' });
    expect(createFatturaPvMock).not.toHaveBeenCalled();
  });

  it('provider mock: la valvola emette alla firma, IN_ATTESA', async () => {
    isPaymentLiveMock.mockReturnValue(false);
    await firmaPraticaCore('pr-1', { tipo: 'ADMIN', motivo: 'attestazione di test' });
    expect(createFatturaPvMock).toHaveBeenCalledWith({
      feeAddebitoId: 'fee-1',
      statoPagamento: 'IN_ATTESA',
    });
  });
});

describe('avvio addebito alla firma', () => {
  it('provider live: chiama processFeeAddebito col fee appena creato', async () => {
    isPaymentLiveMock.mockReturnValue(true);
    await firmaPraticaCore('pr-1', { tipo: 'ADMIN', motivo: 'attestazione di test' });
    expect(processFeeMock).toHaveBeenCalledWith('fee-1');
  });

  it('un addebito che esplode non fa fallire la firma', async () => {
    isPaymentLiveMock.mockReturnValue(true);
    processFeeMock.mockRejectedValue(new Error('stripe giù'));
    const out = await firmaPraticaCore('pr-1', { tipo: 'ADMIN', motivo: 'attestazione di test' });
    expect(out.ok).toBe(true);
  });
});

/**
 * Cablaggio della N8: è la mail che dice all'agenzia se la fattura è nel
 * pacchetto o se arriverà dopo. In modalità mock la N8 È la consegna della
 * fattura (la riconciliazione oraria è inerte lì), quindi `inviatoEmailAt`
 * scritto sulla valvola è il perno che rende sicuro il passaggio mock → live.
 */
describe('N8 e allegato fattura alla firma', () => {
  it('il blocco notifiche viene davvero raggiunto (la N8 parte)', async () => {
    isPaymentLiveMock.mockReturnValue(true);
    await firmaPraticaCore('pr-1', { tipo: 'ADMIN', motivo: 'attestazione di test' });
    expect(ultimaNotifica('N8_AGENZIA_ADDEBITO')).toBeDefined();
  });

  it('provider live: N8 senza allegato e fatturaAllegata false (la fattura nasce all’incasso)', async () => {
    isPaymentLiveMock.mockReturnValue(true);
    await firmaPraticaCore('pr-1', { tipo: 'ADMIN', motivo: 'attestazione di test' });
    const call = ultimaNotifica('N8_AGENZIA_ADDEBITO')!;
    expect(call[0].payload.fatturaAllegata).toBe(false);
    expect(call[1].attachments).toBeUndefined();
    // In live il PDF non si costruisce nemmeno: non c'è ancora nulla da allegare.
    expect(fatturaPvAttachmentMock).not.toHaveBeenCalled();
  });

  it('provider live: nessuna prenotazione di inviatoEmailAt (la N53 la farà a suo tempo)', async () => {
    isPaymentLiveMock.mockReturnValue(true);
    await firmaPraticaCore('pr-1', { tipo: 'ADMIN', motivo: 'attestazione di test' });
    expect(prismaMock.documentoFiscale.updateMany).not.toHaveBeenCalled();
  });

  it('provider mock: N8 con allegato, fatturaAllegata true e inviatoEmailAt scritto', async () => {
    isPaymentLiveMock.mockReturnValue(false);
    await firmaPraticaCore('pr-1', { tipo: 'ADMIN', motivo: 'attestazione di test' });
    const call = ultimaNotifica('N8_AGENZIA_ADDEBITO')!;
    expect(call[0].payload.fatturaAllegata).toBe(true);
    expect(call[1].attachments).toEqual([ALLEGATO]);
    expect(prismaMock.documentoFiscale.updateMany).toHaveBeenCalledWith({
      where: { praticaId: 'pr-1', tipo: 'FATTURA_PV', inviatoEmailAt: null },
      data: { inviatoEmailAt: expect.any(Date) },
    });
  });

  it('provider mock, allegato non generabile: logga con l’id pratica e manda senza allegato', async () => {
    isPaymentLiveMock.mockReturnValue(false);
    const errore = new Error('pdf ko');
    fatturaPvAttachmentMock.mockRejectedValue(errore);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await firmaPraticaCore('pr-1', { tipo: 'ADMIN', motivo: 'attestazione di test' });
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('pr-1'), errore);
      const call = ultimaNotifica('N8_AGENZIA_ADDEBITO')!;
      expect(call[0].payload.fatturaAllegata).toBe(false);
      expect(call[1].attachments).toBeUndefined();
      // Senza allegato non si prenota nulla: la fattura non è stata consegnata.
      expect(prismaMock.documentoFiscale.updateMany).not.toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
    }
  });
});
