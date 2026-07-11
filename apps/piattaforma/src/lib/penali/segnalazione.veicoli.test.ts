import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * `segnalaPraticaAction` deve persistere QUALI veicoli sono segnalati: è la base
 * di calcolo della penale (€25 × veicoli segnalati). Senza questi test, un
 * `veicoliIds` ignorato passerebbe inosservato — l'azione tornerebbe comunque
 * { ok: true } e la penale ricadrebbe muta sul fallback a 1 veicolo.
 */

const { prismaMock, authMock, redirectMock, requirePermessoMock, getSessionContextMock } =
  vi.hoisted(() => ({
    prismaMock: {
      pratica: { findUnique: vi.fn(), update: vi.fn() },
      veicolo: { updateMany: vi.fn() },
      $transaction: vi.fn((ops: unknown[]) => Promise.resolve(ops)),
    },
    authMock: vi.fn(),
    redirectMock: vi.fn((url: string) => {
      throw new Error(`__REDIRECT__:${url}`);
    }),
    requirePermessoMock: vi.fn(),
    getSessionContextMock: vi.fn(),
  }));

vi.mock('@pv/db', () => ({ prisma: prismaMock }));
vi.mock('@/auth', () => ({ auth: authMock }));
vi.mock('next/navigation', () => ({ redirect: redirectMock }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/auth/permessi/guard', () => ({ requirePermesso: requirePermessoMock }));
vi.mock('@/lib/auth/session-context', () => ({ getSessionContext: getSessionContextMock }));
vi.mock('@/lib/sedi/scope-filters', () => ({
  toSedeScope: vi.fn(() => ({ kind: 'ALL' })),
  NO_SEDE_SCOPE: { kind: 'NONE' },
}));
vi.mock('@/lib/pratiche/access', () => ({ canAccessPratica: vi.fn(() => true) }));
vi.mock('@/lib/notifiche', () => ({
  sendNotification: vi.fn(() => Promise.resolve()),
  getAdminEmails: vi.fn(() => Promise.resolve([])),
  notifyClientiAvanzamento: vi.fn(() => Promise.resolve()),
}));
vi.mock('@/lib/notifiche/pratica', () => ({ destinatariAgenzia: vi.fn(() => Promise.resolve([])) }));
vi.mock('@/lib/eventi/emit', () => ({ emitEventiPratica: vi.fn(() => Promise.resolve()) }));
vi.mock('@/lib/eventi/pratica-eventi', () => ({ eventoPraticaPenale: vi.fn(() => ({})) }));

import { segnalaPraticaAction } from './segnalazione';

const PID = '33333333-3333-4333-8333-333333333333';
const AGENZIA_ID = 'ag-1';
const V1 = 'veicolo-1';
const V2 = 'veicolo-2';

beforeEach(() => {
  vi.clearAllMocks();
  authMock.mockResolvedValue({
    user: { id: 'u-1', companyId: AGENZIA_ID, companyType: 'AGENZIA', role: 'ADMIN_AZIENDA' },
  });
  requirePermessoMock.mockResolvedValue({ ok: true });
  getSessionContextMock.mockResolvedValue({});
  prismaMock.pratica.findUnique.mockResolvedValue({
    id: PID,
    stato: 'ACCETTATA',
    agenziaAssegnataId: AGENZIA_ID,
    brokerId: 'br-1',
    brokerSedeId: 'sede-br',
    agenziaSedeId: 'sede-ag',
    flagSegnalata: false,
    codicePratica: 'PV-42',
    veicoli: [
      { id: V1, targa: 'AA000AA' },
      { id: V2, targa: 'BB111BB' },
    ],
    broker: { ragioneSociale: 'Broker SRL' },
    agenziaAssegnata: { ragioneSociale: 'Agenzia SRL' },
  });
  prismaMock.pratica.update.mockResolvedValue({});
  prismaMock.veicolo.updateMany.mockResolvedValue({ count: 1 });
});

describe('segnalaPraticaAction — veicoli segnalati', () => {
  it('marca segnalato=true SOLO sui veicoli indicati', async () => {
    const res = await segnalaPraticaAction(PID, 'FERMO_AMMINISTRATIVO', '', [V2]);

    expect(res).toEqual({ ok: true });
    expect(prismaMock.veicolo.updateMany).toHaveBeenCalledWith({
      where: { praticaId: PID, id: { in: [V2] } },
      data: { segnalato: true },
    });
  });

  it('rifiuta se non è indicato alcun veicolo', async () => {
    const res = await segnalaPraticaAction(PID, 'FERMO_AMMINISTRATIVO', '', []);

    expect(res).toEqual({ ok: false, error: 'Seleziona almeno un veicolo' });
    expect(prismaMock.pratica.update).not.toHaveBeenCalled();
    expect(prismaMock.veicolo.updateMany).not.toHaveBeenCalled();
  });

  it('rifiuta veicoli che non appartengono alla pratica (forgiatura POST)', async () => {
    const res = await segnalaPraticaAction(PID, 'IPOTECA', '', ['veicolo-di-un-altro']);

    expect(res).toEqual({ ok: false, error: 'Veicolo non appartenente alla pratica' });
    expect(prismaMock.pratica.update).not.toHaveBeenCalled();
    expect(prismaMock.veicolo.updateMany).not.toHaveBeenCalled();
  });
});
