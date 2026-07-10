import { describe, it, expect, vi, beforeEach } from 'vitest';

const { authMock, cookiesMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  cookiesMock: vi.fn(),
}));

vi.mock('@/auth', () => ({ auth: authMock }));
vi.mock('next/headers', () => ({ cookies: cookiesMock }));
vi.mock('@pv/db', () => ({
  prisma: {
    sede: { findMany: vi.fn() },
    userSede: { findMany: vi.fn() },
    user: { findUnique: vi.fn() },
    company: { findUnique: vi.fn() },
  },
}));

import { prisma } from '@pv/db';
import { getSessionContext, SEDE_COOKIE } from './session-context';

const sedeFindMany = vi.mocked(prisma.sede.findMany);
const userSedeFindMany = vi.mocked(prisma.userSede.findMany);
const userFindUnique = vi.mocked(prisma.user.findUnique);
const companyFindUnique = vi.mocked(prisma.company.findUnique);

const sedeA = { id: 'a', nome: 'Sede A', type: 'AGENZIA' as const };
const sedeB = { id: 'b', nome: 'Sede B', type: 'AGENZIA' as const };

function setCookie(value: string | null) {
  cookiesMock.mockResolvedValue({
    get: (name: string) => (name === SEDE_COOKIE && value !== null ? { value } : undefined),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  setCookie(null);
  sedeFindMany.mockResolvedValue([sedeA, sedeB] as never);
  userSedeFindMany.mockResolvedValue([] as never);
  userFindUnique.mockResolvedValue({ permessi: [] } as never);
  companyFindUnique.mockResolvedValue({ type: 'AGENZIA' } as never);
});

describe('getSessionContext', () => {
  it('ritorna null se non c’è sessione', async () => {
    authMock.mockResolvedValue(null);
    expect(await getSessionContext()).toBeNull();
  });

  it('admin piattaforma (companyId null): nessun contesto sede', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN_PIATTAFORMA' } });
    const ctx = await getSessionContext();
    expect(ctx).not.toBeNull();
    expect(ctx!.isOwner).toBe(false);
    expect(ctx!.accessibleSedi).toEqual([]);
    expect(ctx!.currentSede).toBeNull();
    expect(sedeFindMany).not.toHaveBeenCalled();
  });

  it('proprietario (ADMIN_AZIENDA): tutte le sedi della madre + vista ALL', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN_AZIENDA', companyId: 'c1' } });
    const ctx = await getSessionContext();
    expect(ctx!.isOwner).toBe(true);
    expect(ctx!.accessibleSedi).toEqual([sedeA, sedeB]);
    expect(ctx!.currentSede).toEqual({ kind: 'ALL' });
    expect(ctx!.scopeIds).toEqual(['a', 'b']);
  });

  it('operatore: solo sedi in membership; cookie valido → quella sede', async () => {
    authMock.mockResolvedValue({ user: { id: 'u2', role: 'UTENTE_AZIENDA', companyId: 'c1' } });
    userSedeFindMany.mockResolvedValue([{ sedeId: 'b' }] as never);
    setCookie('b');
    const ctx = await getSessionContext();
    expect(ctx!.isOwner).toBe(false);
    expect(ctx!.accessibleSedi).toEqual([sedeB]);
    expect(ctx!.currentSede).toEqual({ kind: 'ONE', sede: sedeB });
    expect(ctx!.scopeIds).toEqual(['b']);
  });

  it('non-owner: filtra chiavi permessi obsolete (not in catalogo)', async () => {
    authMock.mockResolvedValue({ user: { id: 'u2', role: 'UTENTE_AZIENDA', companyId: 'c1' } });
    userSedeFindMany.mockResolvedValue([{ sedeId: 'a' }] as never);
    // Simula un utente che ha in DB sia permessi validi che chiavi rimaste da un refactor precedente.
    userFindUnique.mockResolvedValue({ permessi: ['pratiche.view', 'chiave.obsoleta'] } as never);
    const ctx = await getSessionContext();
    // Il set deve contenere solo 'pratiche.view'; 'chiave.obsoleta' deve essere filtrata via.
    expect([...ctx!.permessi].sort()).toEqual(['pratiche.view']);
  });

  it('owner (ADMIN_AZIENDA): non legge permessi dal DB', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN_AZIENDA', companyId: 'c1' } });
    const ctx = await getSessionContext();
    // L'owner non deve leggere il campo permessi dal DB.
    expect(userFindUnique).not.toHaveBeenCalled();
    // Il set deve essere vuoto (l'owner ha poteri impliciti, gestiti altrove).
    expect([...ctx!.permessi].sort()).toEqual([]);
  });
});
