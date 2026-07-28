import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Recapiti N4/N31 nel blocco post-firma di `firmaPraticaCore`.
 *
 * Dal 2026-07-28 la N4 "pratica terminata" NON è più cablata sull'admin
 * dell'azienda madre: la firma chiude il lavoro di chi ha fatto la pratica, e
 * la notifica deve arrivare a lui e ai suoi colleghi di sede come tutte le
 * altre. Passa quindi dallo stesso risolutore della N31.
 *
 * Resta il vincolo di privacy che ha tenuto la N4 all'admin fino a ieri: il
 * `saldoCent` è la cassa dell'azienda e va SOLO al titolare (`isOwner`). Agli
 * operatori arriva `null`, cioè la riga del saldo sparisce dall'email — vedono
 * il `creditoCent` della pratica che hanno portato, non il conto dell'azienda.
 *
 * Senza questo test un domani basterebbe passare `saldoCent` fisso nel ciclo
 * per mandare il saldo wallet a tutta la filiale, e nessun altro test se ne
 * accorgerebbe (`actions.authz.test.ts` si ferma prima, sul controllo stato).
 */

const {
  prismaMock,
  authMock,
  getSessionContextMock,
  redirectMock,
  sendNotificationMock,
  destinatariBrokerMock,
} = vi.hoisted(() => ({
  prismaMock: {
    pratica: { findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    commissioneAffiliazione: { findMany: vi.fn() },
    praticaStatoLog: { create: vi.fn() },
    $transaction: vi.fn(async (cb: (t: unknown) => unknown) => cb(prismaMock)),
  },
  authMock: vi.fn(),
  getSessionContextMock: vi.fn(),
  redirectMock: vi.fn((url: string) => {
    throw new Error(`__REDIRECT__:${url}`);
  }),
  sendNotificationMock: vi.fn(() => Promise.resolve()),
  destinatariBrokerMock: vi.fn(),
}));

vi.mock('@pv/db', () => ({ prisma: prismaMock }));
vi.mock('@/auth', () => ({ auth: authMock }));
vi.mock('@/lib/auth/session-context', async (orig) => {
  const actual = (await orig()) as object;
  return { ...actual, getSessionContext: getSessionContextMock };
});
vi.mock('next/navigation', () => ({ redirect: redirectMock }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

vi.mock('@/lib/fee/blocco', () => ({ isAgenziaBloccata: vi.fn(() => Promise.resolve(false)) }));
vi.mock('@/lib/visura/stato', () => ({ isVisuraScadutaCompany: vi.fn(() => Promise.resolve(false)) }));
vi.mock('@/lib/notifiche', () => ({
  sendNotification: sendNotificationMock,
  notifyClientiAvanzamento: vi.fn(() => Promise.resolve()),
}));
// N31 passa dal risolutore: qui lo mocchiamo per controllare esattamente chi
// riceve cosa, senza dover ricostruire tutta la catena preferito/sede/admin.
vi.mock('@/lib/notifiche/pratica', () => ({ destinatariBroker: destinatariBrokerMock }));
vi.mock('@/lib/affiliazione/accredit', () => ({
  accreditCommissioniAffiliazione: vi.fn(() =>
    Promise.resolve({ commissioniCreate: 0, importoTotaleCent: 0, accrediti: [] }),
  ),
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
  eventoPraticaLavorata: vi.fn(() => ({})),
  eventoPraticaFirmata: vi.fn(() => ({})),
  eventoPraticaAnnullata: vi.fn(() => ({})),
}));

import { firmaFromListaAction } from './actions';

const PID = '11111111-1111-4111-8111-111111111111';
const AGENZIA = 'ag-1';
const BROKER = 'br-1';
const SEDE_MIA = 'sede-mia';

const ADMIN_AZIENDA_EMAIL = 'admin-azienda@example.com';
const RISOLUTORE_EMAIL_1 = 'operatore-sede-1@example.com';
const RISOLUTORE_EMAIL_2 = 'operatore-sede-2@example.com';

/** Pratica PROCESSATA della propria sede, pronta per superare firmaPraticaCore fino in fondo. */
const praticaDaFirmare = () => ({
  id: PID,
  brokerId: BROKER,
  brokerSedeId: SEDE_MIA,
  agenziaAssegnataId: AGENZIA,
  agenziaSedeId: SEDE_MIA,
  stato: 'PROCESSATA',
  feeAgenziaCent: 0,
  creditoBrokerCent: 0,
  broker: {},
  agenziaAssegnata: {},
});

/** Ricarico post-transazione: shape completo letto dal blocco N4/N8/N31. */
const praticaCompleta = () => ({
  id: PID,
  codicePratica: 'PV-2026-0099',
  creditoBrokerCent: 5000,
  autoAddebitoAt: null, // N8 non parte: fuori scope di questo test
  brokerSedeId: SEDE_MIA,
  veicoli: [{ targa: 'AB123CD' }],
  broker: {
    id: BROKER,
    ragioneSociale: 'Broker SRL',
    email: 'fallback-broker@example.com',
    wallet: { saldoCent: 123456 },
    users: [{ email: ADMIN_AZIENDA_EMAIL, nome: 'Admin Azienda', id: 'admin-user-1' }],
  },
  agenziaAssegnata: {
    ragioneSociale: 'Agenzia SRL',
    email: 'agenzia@example.com',
    users: [],
  },
});

function sessione(): void {
  authMock.mockResolvedValue({
    user: { id: 'u1', companyId: AGENZIA, companyType: 'AGENZIA', role: 'OPERATORE' },
  });
  getSessionContextMock.mockResolvedValue({
    user: { id: 'u1', companyId: AGENZIA, companyType: 'AGENZIA', role: 'OPERATORE' },
    companyId: AGENZIA,
    companyType: 'AGENZIA',
    isOwner: false,
    accessibleSedi: [{ id: SEDE_MIA, nome: 'Mia', type: 'AGENZIA' }],
    currentSede: { kind: 'ONE', sede: { id: SEDE_MIA, nome: 'Mia', type: 'AGENZIA' } },
    scopeIds: [SEDE_MIA],
    membershipRuoli: {},
    permessi: new Set(['pratiche.view', 'pratiche.firma']),
    sospensione: { sospeso: false, motivo: null, origine: null },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  sendNotificationMock.mockImplementation(() => Promise.resolve());
  prismaMock.$transaction.mockImplementation(async (cb: (t: unknown) => unknown) => cb(prismaMock));
  prismaMock.pratica.update.mockResolvedValue({});
  prismaMock.pratica.updateMany.mockResolvedValue({ count: 1 });
  prismaMock.commissioneAffiliazione.findMany.mockResolvedValue([]);
  // Pratica lavorata da un operatore: il risolutore restituisce lui e il
  // collega di sede, e NON il titolare (è il risolutore stesso a escluderlo).
  destinatariBrokerMock.mockResolvedValue([
    { email: RISOLUTORE_EMAIL_1, userId: 'op-1', nome: 'Operatore Uno', isOwner: false },
    { email: RISOLUTORE_EMAIL_2, userId: 'op-2', nome: 'Operatore Due', isOwner: false },
  ]);
});

type SendNotificationArg = {
  tipo: string;
  target: { email: string };
  payload: { saldoCent: number | null; creditoCent: number };
};

function inviate(): SendNotificationArg[][] {
  return sendNotificationMock.mock.calls as unknown as SendNotificationArg[][];
}

describe('firmaPraticaCore — recapiti N4 e N31', () => {
  it('pratica di un operatore: N4 e N31 vanno agli operatori, mai al titolare', async () => {
    sessione();
    prismaMock.pratica.findUnique
      .mockResolvedValueOnce(praticaDaFirmare()) // letta dentro la $transaction
      .mockResolvedValueOnce(praticaCompleta()); // ricaricata per N4/N8/N31

    const res = await firmaFromListaAction(PID);

    expect(res).toEqual({ ok: true });

    const calls = inviate();
    const n4Calls = calls.filter((call) => call[0].tipo === 'N4_BROKER_FIRMA_E_CREDITO');
    const n31Calls = calls.filter((call) => call[0].tipo === 'N31_VALUTA_AGENZIA');

    // N4: una per destinatario del risolutore. L'admin azienda non compare:
    // non ha lavorato lui la pratica.
    const n4Emails = n4Calls.map((call) => call[0].target.email).sort();
    expect(n4Emails).toEqual([RISOLUTORE_EMAIL_1, RISOLUTORE_EMAIL_2].sort());
    expect(n4Emails).not.toContain(ADMIN_AZIENDA_EMAIL);

    // N31: stesso recapito della N4.
    const n31Emails = n31Calls.map((call) => call[0].target.email).sort();
    expect(n31Emails).toEqual([RISOLUTORE_EMAIL_1, RISOLUTORE_EMAIL_2].sort());
    expect(n31Emails).not.toContain(ADMIN_AZIENDA_EMAIL);
  });

  it('agli operatori la N4 non porta il saldo del wallet, solo il credito della pratica', async () => {
    sessione();
    prismaMock.pratica.findUnique
      .mockResolvedValueOnce(praticaDaFirmare())
      .mockResolvedValueOnce(praticaCompleta());

    await firmaFromListaAction(PID);

    const n4 = inviate().filter((call) => call[0].tipo === 'N4_BROKER_FIRMA_E_CREDITO');
    expect(n4).toHaveLength(2);
    for (const call of n4) {
      expect(call[0].payload.saldoCent).toBeNull();
      expect(call[0].payload.creditoCent).toBe(5000);
    }
  });

  it('pratica del titolare: la sua N4 porta il saldo, quella dei colleghi no', async () => {
    sessione();
    destinatariBrokerMock.mockResolvedValue([
      { email: ADMIN_AZIENDA_EMAIL, userId: 'admin-user-1', nome: 'Admin Azienda', isOwner: true },
      { email: RISOLUTORE_EMAIL_1, userId: 'op-1', nome: 'Operatore Uno', isOwner: false },
    ]);
    prismaMock.pratica.findUnique
      .mockResolvedValueOnce(praticaDaFirmare())
      .mockResolvedValueOnce(praticaCompleta());

    await firmaFromListaAction(PID);

    const n4 = inviate().filter((call) => call[0].tipo === 'N4_BROKER_FIRMA_E_CREDITO');
    const perEmail = new Map(n4.map((call) => [call[0].target.email, call[0].payload]));
    expect(perEmail.get(ADMIN_AZIENDA_EMAIL)?.saldoCent).toBe(123456);
    expect(perEmail.get(RISOLUTORE_EMAIL_1)?.saldoCent).toBeNull();
  });
});
