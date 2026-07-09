import { describe, it, expect, vi, beforeEach } from 'vitest';

const { getSessionContextMock, prismaMock } = vi.hoisted(() => ({
  getSessionContextMock: vi.fn(),
  prismaMock: {
    pratica: { count: vi.fn((_args?: unknown) => Promise.resolve(0)) },
    praticaAssegnazione: { count: vi.fn((_args?: unknown) => Promise.resolve(0)) },
    segnalazioneCreazione: { count: vi.fn((_args?: unknown) => Promise.resolve(0)) },
  },
}));

vi.mock('@pv/db', () => ({ prisma: prismaMock }));
// @/auth (next-auth) non risolve sotto Vitest (next/server via next-auth/lib/env);
// va mockato anche se non chiamato direttamente qui, perché session-context.ts
// (il modulo "orig" da cui spreadiamo) lo importa a sua volta. Stessa
// convenzione di apps/piattaforma/src/app/team/actions.authz.test.ts.
vi.mock('@/auth', () => ({ auth: vi.fn() }));
vi.mock('@/lib/auth/session-context', async (orig) => {
  const actual = (await orig()) as object;
  return { ...actual, getSessionContext: getSessionContextMock };
});

import { GET } from './route';

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.pratica.count.mockResolvedValue(0);
  prismaMock.praticaAssegnazione.count.mockResolvedValue(0);
  prismaMock.segnalazioneCreazione.count.mockResolvedValue(0);
});

/** Lo staff piattaforma non ha azienda: companyId undefined, nessuna sede. */
function staffCtx(role: string) {
  return {
    user: { id: 'staff1', role },
    companyId: undefined,
    isOwner: false,
    scopeIds: [],
    currentSede: null,
    accessibleSedi: [],
    membershipRuoli: {},
  };
}

describe('GET /api/badges — scoping sede', () => {
  it("l'agenzia non-owner conta solo le pratiche della sua sede", async () => {
    getSessionContextMock.mockResolvedValue({
      user: { id: 'u1', role: 'OPERATORE', companyType: 'AGENZIA' },
      companyId: 'c1',
      isOwner: false,
      scopeIds: ['sedeAssago'],
      currentSede: { kind: 'ONE', sede: { id: 'sedeAssago' } },
      accessibleSedi: [],
      membershipRuoli: {},
    });

    await GET();

    expect(prismaMock.pratica.count).toHaveBeenCalledWith({
      where: {
        AND: [
          { agenziaAssegnataId: 'c1', deletedAt: null, agenziaSedeId: { in: ['sedeAssago'] } },
          { stato: { notIn: ['BOZZA', 'FIRMATA', 'ANNULLATA', 'SCADUTA'] } },
        ],
      },
    });
    expect(prismaMock.praticaAssegnazione.count).toHaveBeenCalledWith({
      where: { agenziaId: 'c1', esito: 'PENDING', sedeId: { in: ['sedeAssago'] } },
    });
  });

  it("l'owner in vista aggregata conta comunque solo le sue sedi (badge = lista)", async () => {
    getSessionContextMock.mockResolvedValue({
      user: { id: 'u1', role: 'ADMIN_AZIENDA', companyType: 'AGENZIA' },
      companyId: 'c1',
      isOwner: true,
      scopeIds: ['s1', 's2'],
      currentSede: { kind: 'ALL' },
      accessibleSedi: [],
      membershipRuoli: {},
    });

    await GET();

    expect(prismaMock.pratica.count).toHaveBeenCalledWith({
      where: {
        AND: [
          { agenziaAssegnataId: 'c1', deletedAt: null, agenziaSedeId: { in: ['s1', 's2'] } },
          { stato: { notIn: ['BOZZA', 'FIRMATA', 'ANNULLATA', 'SCADUTA'] } },
        ],
      },
    });
  });

  it("l'agenzia non innesca i conteggi admin", async () => {
    getSessionContextMock.mockResolvedValue({
      user: { id: 'u1', role: 'OPERATORE', companyType: 'AGENZIA' },
      companyId: 'c1',
      isOwner: false,
      scopeIds: ['s1'],
      currentSede: { kind: 'ONE', sede: { id: 's1' } },
      accessibleSedi: [],
      membershipRuoli: {},
    });

    await GET();

    expect(prismaMock.segnalazioneCreazione.count).not.toHaveBeenCalled();
  });

  it('senza sedi accessibili non conta nulla (fail-closed)', async () => {
    getSessionContextMock.mockResolvedValue({
      user: { id: 'u1', role: 'OPERATORE', companyType: 'AGENZIA' },
      companyId: 'c1',
      isOwner: false,
      scopeIds: [],
      currentSede: null,
      accessibleSedi: [],
      membershipRuoli: {},
    });

    await GET();

    expect(prismaMock.pratica.count).toHaveBeenCalledWith({
      where: {
        AND: [
          { agenziaAssegnataId: 'c1', deletedAt: null, agenziaSedeId: { in: [] } },
          { stato: { notIn: ['BOZZA', 'FIRMATA', 'ANNULLATA', 'SCADUTA'] } },
        ],
      },
    });
  });
});

describe('GET /api/badges — badge admin piattaforma', () => {
  it('conta le segnalazioni RICEVUTA e i problemi creazione APERTA (badge = lista)', async () => {
    getSessionContextMock.mockResolvedValue(staffCtx('ADMIN_PIATTAFORMA'));
    prismaMock.pratica.count.mockResolvedValue(3);
    prismaMock.segnalazioneCreazione.count.mockResolvedValue(2);

    const res = await GET();
    const body = (await res.json()) as Record<string, number>;

    // Stesse where delle liste che i badge aprono: /admin/segnalazioni e
    // /admin/segnalazioni-creazione. Se divergono torna il "numerino pieno,
    // lista vuota".
    expect(prismaMock.pratica.count).toHaveBeenCalledWith({
      where: { flagSegnalata: true, segnalazioneStato: 'RICEVUTA' },
    });
    expect(prismaMock.segnalazioneCreazione.count).toHaveBeenCalledWith({
      where: { stato: 'APERTA' },
    });
    expect(body).toMatchObject({
      segnalazioni: 3,
      segnalazioniCreazione: 2,
      inbox: 0,
      praticheAttive: 0,
    });
  });

  it("l'assistente non vede i badge admin e non interroga il DB", async () => {
    getSessionContextMock.mockResolvedValue(staffCtx('ASSISTENTE'));

    const res = await GET();
    const body = (await res.json()) as Record<string, number>;

    expect(prismaMock.pratica.count).not.toHaveBeenCalled();
    expect(prismaMock.segnalazioneCreazione.count).not.toHaveBeenCalled();
    expect(body).toMatchObject({ segnalazioni: 0, segnalazioniCreazione: 0 });
  });
});
