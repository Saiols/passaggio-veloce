import { describe, it, expect, vi, beforeEach } from 'vitest';

const { getSessionContextMock, prismaMock } = vi.hoisted(() => ({
  getSessionContextMock: vi.fn(),
  prismaMock: {
    pratica: { count: vi.fn((_args?: unknown) => Promise.resolve(0)) },
    praticaAssegnazione: { count: vi.fn((_args?: unknown) => Promise.resolve(0)) },
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
});

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
