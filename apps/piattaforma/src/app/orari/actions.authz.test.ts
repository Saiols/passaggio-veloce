import { describe, it, expect, vi, beforeEach } from 'vitest';

const { authMock, getOperatingSedeMock, getSedeRoleMock, prismaMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  getOperatingSedeMock: vi.fn(),
  getSedeRoleMock: vi.fn(),
  prismaMock: {
    orariApertura: { upsert: vi.fn() },
  },
}));

vi.mock('@/auth', () => ({ auth: authMock }));
vi.mock('@/lib/auth/session-context', () => ({
  getOperatingSede: getOperatingSedeMock,
  getSedeRole: getSedeRoleMock,
}));
vi.mock('@pv/db', () => ({ prisma: prismaMock }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { updateOrariAction } from './actions';

beforeEach(() => {
  vi.clearAllMocks();
  authMock.mockResolvedValue({ user: { companyType: 'AGENZIA', companyId: 'c1' } });
  getOperatingSedeMock.mockResolvedValue({ id: 's1', nome: 'Sede 1', type: 'AGENZIA' });
});

describe('updateOrariAction — gate autorizzazione impostazioni sede', () => {
  it('OPERATORE → negato, orariApertura.upsert NON chiamato', async () => {
    getSedeRoleMock.mockResolvedValue('OPERATORE');
    const res = await updateOrariAction(new FormData());
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/admin di sede/i);
    expect(prismaMock.orariApertura.upsert).not.toHaveBeenCalled();
  });

  it('sede non accessibile (ruolo null) → negato, orariApertura.upsert NON chiamato', async () => {
    getSedeRoleMock.mockResolvedValue(null);
    const res = await updateOrariAction(new FormData());
    expect(res.ok).toBe(false);
    expect(prismaMock.orariApertura.upsert).not.toHaveBeenCalled();
  });

  it('ADMIN_SEDE → consentito, orariApertura.upsert chiamato per ciascun giorno', async () => {
    getSedeRoleMock.mockResolvedValue('ADMIN_SEDE');
    // FormData vuota = tutte le fasce assenti → tutti i giorni chiusi, comunque valido.
    const res = await updateOrariAction(new FormData());
    expect(res.ok).toBe(true);
    expect(prismaMock.orariApertura.upsert).toHaveBeenCalledTimes(7);
  });
});
