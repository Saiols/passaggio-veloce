import { describe, it, expect, vi, beforeEach } from 'vitest';

const { authMock, getOperatingSedeMock, getSessionContextMock, prismaMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  getOperatingSedeMock: vi.fn(),
  getSessionContextMock: vi.fn(),
  prismaMock: {
    orariApertura: { upsert: vi.fn() },
  },
}));

vi.mock('@/auth', () => ({ auth: authMock }));
vi.mock('@/lib/auth/session-context', () => ({
  getOperatingSede: getOperatingSedeMock,
  getSessionContext: getSessionContextMock,
}));
vi.mock('@pv/db', () => ({ prisma: prismaMock }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { updateOrariAction } from './actions';

const SEDE = { id: 's1', nome: 'Sede 1', type: 'AGENZIA' as const };

const ctxConPermessi = (permessi: string[], overrides: Record<string, unknown> = {}) => ({
  user: { id: 'u1', role: 'UTENTE_AZIENDA' },
  companyId: 'c1',
  companyType: 'AGENZIA' as const,
  isOwner: false,
  accessibleSedi: [SEDE],
  currentSede: { kind: 'ONE' as const, sede: SEDE },
  scopeIds: ['s1'],
  membershipRuoli: { s1: 'OPERATORE' as const },
  permessi: new Set(permessi),
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  authMock.mockResolvedValue({ user: { companyType: 'AGENZIA', companyId: 'c1' } });
  getOperatingSedeMock.mockResolvedValue(SEDE);
  getSessionContextMock.mockResolvedValue(ctxConPermessi(['orari.view', 'orari.edit']));
});

describe('updateOrariAction — capability', () => {
  it('senza orari.edit → negato, orariApertura.upsert NON chiamato', async () => {
    getSessionContextMock.mockResolvedValue(ctxConPermessi(['orari.view']));
    const res = await updateOrariAction(new FormData());
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain('permessi');
    expect(prismaMock.orariApertura.upsert).not.toHaveBeenCalled();
  });

  it('senza permessi → negato, orariApertura.upsert NON chiamato', async () => {
    getSessionContextMock.mockResolvedValue(ctxConPermessi([]));
    const res = await updateOrariAction(new FormData());
    expect(res.ok).toBe(false);
    expect(prismaMock.orariApertura.upsert).not.toHaveBeenCalled();
  });

  it('con orari.edit → consentito, orariApertura.upsert chiamato per ciascun giorno', async () => {
    // FormData vuota = tutte le fasce assenti → tutti i giorni chiusi, comunque valido.
    const res = await updateOrariAction(new FormData());
    expect(res.ok).toBe(true);
    expect(prismaMock.orariApertura.upsert).toHaveBeenCalledTimes(7);
  });

  it('proprietario → consentito anche senza permessi espliciti (isOwner bypassa)', async () => {
    getSessionContextMock.mockResolvedValue(ctxConPermessi([], { isOwner: true }));
    const res = await updateOrariAction(new FormData());
    expect(res.ok).toBe(true);
  });

  it('senza orari.edit: il gate blocca PRIMA di risolvere la sede operativa', async () => {
    getSessionContextMock.mockResolvedValue(ctxConPermessi(['orari.view']));
    await updateOrariAction(new FormData());
    expect(getOperatingSedeMock).not.toHaveBeenCalled();
  });
});
