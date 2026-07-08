import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Gate di scoping per sede su `richiediRevisioneManualeAction`, e sede sulla
 * bozza placeholder che la stessa action crea.
 *
 * Due difetti distinti:
 *  1. su una bozza esistente si controllava solo `brokerId` (company), quindi
 *     un utente della sede A poteva marcare "richiede revisione" la bozza della
 *     sede B;
 *  2. la bozza placeholder (richiesta senza pratica) nasceva SENZA
 *     `brokerSedeId`, quindi era invisibile al suo stesso broker: la lista
 *     `/pratiche` filtra per sede.
 */

const { prismaMock, authMock, getSessionContextMock, redirectMock } =
  vi.hoisted(() => ({
    prismaMock: {
      pratica: { findUnique: vi.fn(), update: vi.fn(), create: vi.fn() },
      user: { findMany: vi.fn(() => Promise.resolve([])) },
    },
    authMock: vi.fn(),
    getSessionContextMock: vi.fn(),
    redirectMock: vi.fn((url: string) => {
      throw new Error(`__REDIRECT__:${url}`);
    }),
  }));

vi.mock('@pv/db', () => ({ prisma: prismaMock }));
vi.mock('@/auth', () => ({ auth: authMock }));
vi.mock('@/lib/auth/session-context', async (orig) => {
  const actual = (await orig()) as object;
  // `getOperatingSede` NON va mockata: la sede operativa la deriva
  // `resolveSubmittedSede` (puro) dal `currentSede` del contesto. Mockarla
  // darebbe una falsa copertura.
  return { ...actual, getSessionContext: getSessionContextMock };
});
vi.mock('next/navigation', () => ({ redirect: redirectMock }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/notifiche', () => ({
  sendNotification: vi.fn(() => Promise.resolve()),
  getAdminEmails: vi.fn(() => Promise.resolve([])),
  notifyClientiAvanzamento: vi.fn(() => Promise.resolve()),
}));

import { richiediRevisioneManualeAction } from './revisione';

const BROKER = 'br-1';
const SEDE_MIA = 'sede-mia';
const SEDE_ALTRA = 'sede-altra';
const PID = '33333333-3333-4333-8333-333333333333';
const NOTE = 'Descrizione sufficientemente lunga del problema riscontrato.';

const bozza = (over: Record<string, unknown> = {}) => ({
  id: PID,
  brokerId: BROKER,
  brokerSedeId: SEDE_ALTRA,
  agenziaAssegnataId: null,
  agenziaSedeId: null,
  stato: 'BOZZA',
  codicePratica: null,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  authMock.mockResolvedValue({
    user: { id: 'u1', companyId: BROKER, companyType: 'DEALER', role: 'OPERATORE' },
  });
  getSessionContextMock.mockResolvedValue({
    user: { id: 'u1', companyId: BROKER, companyType: 'DEALER', role: 'OPERATORE' },
    companyId: BROKER,
    isOwner: false,
    accessibleSedi: [{ id: SEDE_MIA, nome: 'Mia', type: 'DEALER' }],
    currentSede: { kind: 'ONE', sede: { id: SEDE_MIA, nome: 'Mia', type: 'DEALER' } },
    scopeIds: [SEDE_MIA],
    membershipRuoli: {},
  });
  prismaMock.pratica.update.mockResolvedValue({});
  prismaMock.pratica.create.mockResolvedValue({ id: 'nuova', codicePratica: null });
});

describe('richiediRevisioneManualeAction — scoping sede', () => {
  it('rifiuta la bozza di un\'altra sede dello stesso broker', async () => {
    prismaMock.pratica.findUnique.mockResolvedValue(bozza());

    const res = await richiediRevisioneManualeAction(PID, 'RICHIESTA_BROKER', NOTE);

    expect(res).toEqual({ ok: false, error: 'Pratica non trovata' });
    expect(prismaMock.pratica.update).not.toHaveBeenCalled();
  });

  it('accetta la bozza della propria sede', async () => {
    prismaMock.pratica.findUnique.mockResolvedValue(bozza({ brokerSedeId: SEDE_MIA }));

    const res = await richiediRevisioneManualeAction(PID, 'RICHIESTA_BROKER', NOTE);

    expect(res.ok).toBe(true);
    expect(prismaMock.pratica.update).toHaveBeenCalledTimes(1);
  });
});

describe('richiediRevisioneManualeAction — sede sulla bozza placeholder', () => {
  it('la bozza creata senza pratica porta la sede operativa (altrimenti sparisce dalla lista del broker)', async () => {
    const res = await richiediRevisioneManualeAction(null, 'CASO_NON_PREVISTO_DA_SCHEMA', NOTE);

    expect(res.ok).toBe(true);
    const data = prismaMock.pratica.create.mock.calls[0]?.[0]?.data;
    expect(data.brokerId).toBe(BROKER);
    expect(data.brokerSedeId).toBe(SEDE_MIA);
  });

  it('il proprietario in vista aggregata usa la sede scelta nel wizard', async () => {
    // Owner con 2 sedi in vista ALL: non esiste una sede operativa, quindi senza
    // la sede del wizard la bozza nascerebbe invisibile al suo stesso broker.
    getSessionContextMock.mockResolvedValue({
      user: { id: 'u1', companyId: BROKER, companyType: 'DEALER', role: 'ADMIN_AZIENDA' },
      companyId: BROKER,
      isOwner: true,
      accessibleSedi: [
        { id: SEDE_MIA, nome: 'Mia', type: 'DEALER' },
        { id: SEDE_ALTRA, nome: 'Altra', type: 'DEALER' },
      ],
      currentSede: { kind: 'ALL' },
      scopeIds: [SEDE_MIA, SEDE_ALTRA],
      membershipRuoli: {},
    });

    const res = await richiediRevisioneManualeAction(
      null,
      'CASO_NON_PREVISTO_DA_SCHEMA',
      NOTE,
      SEDE_ALTRA,
    );

    expect(res.ok).toBe(true);
    expect(prismaMock.pratica.create.mock.calls[0]?.[0]?.data.brokerSedeId).toBe(SEDE_ALTRA);
  });

  it('un id di sede non accessibile non viene accettato (validato server-side)', async () => {
    getSessionContextMock.mockResolvedValue({
      user: { id: 'u1', companyId: BROKER, companyType: 'DEALER', role: 'ADMIN_AZIENDA' },
      companyId: BROKER,
      isOwner: true,
      accessibleSedi: [
        { id: SEDE_MIA, nome: 'Mia', type: 'DEALER' },
        { id: SEDE_ALTRA, nome: 'Altra', type: 'DEALER' },
      ],
      currentSede: { kind: 'ALL' },
      scopeIds: [SEDE_MIA, SEDE_ALTRA],
      membershipRuoli: {},
    });

    const res = await richiediRevisioneManualeAction(
      null,
      'CASO_NON_PREVISTO_DA_SCHEMA',
      NOTE,
      'sede-di-un-altra-azienda',
    );

    expect(res.ok).toBe(true);
    // Rifiutata: non finisce sulla bozza. Nessun leak cross-azienda.
    expect(prismaMock.pratica.create.mock.calls[0]?.[0]?.data.brokerSedeId).toBeNull();
  });
});
