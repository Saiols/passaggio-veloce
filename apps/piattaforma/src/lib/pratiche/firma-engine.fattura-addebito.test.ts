import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Chi emette la fattura e chi fa partire l'addebito, al variare di
 * isPaymentLive(). È il test che protegge la valvola: se sparisce, un deploy
 * con PAYMENT_PROVIDER=mock smette di produrre fatture senza che nulla lo dica.
 */

const { prismaMock, authMock, redirectMock, createFatturaPvMock, processFeeMock, isPaymentLiveMock } =
  vi.hoisted(() => {
    const prismaMock = {
      pratica: { findUnique: vi.fn(), updateMany: vi.fn() },
      feeAddebito: { create: vi.fn() },
      praticaStatoLog: { create: vi.fn() },
      wallet: { upsert: vi.fn(), update: vi.fn() },
      transazioneWallet: { create: vi.fn() },
      commissioneAffiliazione: { findMany: vi.fn() },
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
  sendNotification: vi.fn(() => Promise.resolve()),
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
vi.mock('@/lib/fatturazione/documento-pdf', () => ({ fatturaPvAttachment: vi.fn(() => Promise.resolve(null)) }));
vi.mock('@/lib/wallet/auto-payout', () => ({ autoPayoutBrokerDopoFirma: vi.fn(() => Promise.resolve()) }));
vi.mock('@/lib/eventi/emit', () => ({ emitEventoPratica: vi.fn(() => Promise.resolve()) }));
vi.mock('@/lib/eventi/pratica-eventi', () => ({ eventoPraticaFirmata: vi.fn(() => ({})) }));
vi.mock('@/lib/jobs/payment-live', () => ({ isPaymentLive: isPaymentLiveMock }));
vi.mock('@/lib/fee/process', () => ({ processFeeAddebito: processFeeMock }));

import { firmaPraticaCore } from './firma-engine';

const PRATICA = {
  id: 'pr-1',
  stato: 'PROCESSATA',
  flagSegnalata: false,
  agenziaAssegnataId: 'ag-1',
  agenziaSedeId: 'sede-1',
  brokerSedeId: null,
  feeAgenziaCent: 7500,
  creditoBrokerCent: 0,
  numeroVeicoli: 1,
  tipo: 'SEMPLICE',
  brokerId: 'br-1',
  broker: { referente: null, referenteSedeId: null },
  agenziaAssegnata: { referente: null, referenteSedeId: null },
};

beforeEach(() => {
  vi.clearAllMocks();
  authMock.mockResolvedValue({ user: { id: 'u-1', role: 'ADMIN_PIATTAFORMA' } });
  prismaMock.pratica.findUnique.mockResolvedValue(PRATICA);
  prismaMock.pratica.updateMany.mockResolvedValue({ count: 1 });
  prismaMock.praticaStatoLog.create.mockResolvedValue({});
  prismaMock.feeAddebito.create.mockResolvedValue({ id: 'fee-1' });
  prismaMock.commissioneAffiliazione.findMany.mockResolvedValue([]);
  createFatturaPvMock.mockResolvedValue({ id: 'doc-1' });
  processFeeMock.mockResolvedValue('SUCCESS');
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
