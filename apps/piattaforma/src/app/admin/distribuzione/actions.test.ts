import { describe, it, expect, vi, beforeEach } from 'vitest';

const { authMock, upsertMock, getConfigMock, revalidateMock, redirectMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  upsertMock: vi.fn(),
  getConfigMock: vi.fn(),
  revalidateMock: vi.fn(),
  redirectMock: vi.fn(),
}));

vi.mock('@/auth', () => ({ auth: authMock }));
vi.mock('@pv/db', () => ({ prisma: { distribuzioneConfig: { upsert: upsertMock } } }));
vi.mock('@/lib/distribuzione/config', () => ({ getDistribuzioneConfig: getConfigMock }));
vi.mock('next/cache', () => ({ revalidatePath: revalidateMock }));
vi.mock('next/navigation', () => ({
  redirect: (...a: unknown[]) => {
    redirectMock(...a);
    throw new Error('NEXT_REDIRECT');
  },
}));

import { salvaConfigDistribuzione } from './actions';

const CONFIG_DEFAULT = {
  raggioStartM: 500,
  stepM: 200,
  raggioMaxM: 10000,
  intervalloMin: 10,
  orarioInizio: '09:00',
  orarioFine: '19:00',
  giorni: ['LUN', 'MAR', 'MER', 'GIO', 'VEN'],
};

beforeEach(() => {
  vi.clearAllMocks();
  getConfigMock.mockResolvedValue(CONFIG_DEFAULT);
  upsertMock.mockResolvedValue({ id: 'singleton' });
});

describe('salvaConfigDistribuzione', () => {
  it('rifiuta sessione assente (redirect a /login), nessuna scrittura', async () => {
    authMock.mockResolvedValue(null);
    await expect(salvaConfigDistribuzione(15000)).rejects.toThrow('NEXT_REDIRECT');
    expect(redirectMock).toHaveBeenCalledWith('/login');
    expect(upsertMock).not.toHaveBeenCalled();
  });

  it('rifiuta i non ADMIN_PIATTAFORMA, nessuna scrittura', async () => {
    authMock.mockResolvedValue({ user: { id: 'x', role: 'ASSISTENTE' } });
    const res = await salvaConfigDistribuzione(15000);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/admin piattaforma/i);
    expect(upsertMock).not.toHaveBeenCalled();
  });

  it('rifiuta raggioMaxM <= raggioStartM (cross-field) con field error, nessuna scrittura', async () => {
    authMock.mockResolvedValue({ user: { id: 'adm', role: 'ADMIN_PIATTAFORMA' } });
    getConfigMock.mockResolvedValue({ ...CONFIG_DEFAULT, raggioStartM: 5000 });

    const res = await salvaConfigDistribuzione(2000);

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/maggiore del raggio iniziale/i);
    expect(upsertMock).not.toHaveBeenCalled();
  });

  it('rifiuta raggioMaxM == raggioStartM (non strettamente maggiore), nessuna scrittura', async () => {
    authMock.mockResolvedValue({ user: { id: 'adm', role: 'ADMIN_PIATTAFORMA' } });
    getConfigMock.mockResolvedValue({ ...CONFIG_DEFAULT, raggioStartM: 2000 });

    const res = await salvaConfigDistribuzione(2000);

    expect(res.ok).toBe(false);
    expect(upsertMock).not.toHaveBeenCalled();
  });

  it('rifiuta valori fuori range (troppo piccolo), nessuna scrittura', async () => {
    authMock.mockResolvedValue({ user: { id: 'adm', role: 'ADMIN_PIATTAFORMA' } });

    const res = await salvaConfigDistribuzione(500); // < RAGGIO_MAX_MIN (1000)

    expect(res.ok).toBe(false);
    expect(upsertMock).not.toHaveBeenCalled();
  });

  it('rifiuta valori fuori range (troppo grande), nessuna scrittura', async () => {
    authMock.mockResolvedValue({ user: { id: 'adm', role: 'ADMIN_PIATTAFORMA' } });

    const res = await salvaConfigDistribuzione(100000); // > RAGGIO_MAX_MAX (50000)

    expect(res.ok).toBe(false);
    expect(upsertMock).not.toHaveBeenCalled();
  });

  it('input valido → upsert sul singleton con raggioMaxM e revalida la pagina', async () => {
    authMock.mockResolvedValue({ user: { id: 'adm', role: 'ADMIN_PIATTAFORMA' } });

    const res = await salvaConfigDistribuzione(15000);

    expect(res.ok).toBe(true);
    expect(upsertMock).toHaveBeenCalledWith({
      where: { id: 'singleton' },
      create: { id: 'singleton', raggioMaxM: 15000 },
      update: { raggioMaxM: 15000 },
    });
    expect(revalidateMock).toHaveBeenCalledWith('/admin/distribuzione');
  });
});
