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
  },
}));

import { prisma } from '@pv/db';
import { getSessionContext, SEDE_COOKIE } from './session-context';

const sedeFindMany = vi.mocked(prisma.sede.findMany);
const userSedeFindMany = vi.mocked(prisma.userSede.findMany);

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
});
