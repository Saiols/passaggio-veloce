import { describe, it, expect, vi, beforeEach } from 'vitest';

const { authMock, upsertMock, revalidateMock, redirectMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  upsertMock: vi.fn(),
  revalidateMock: vi.fn(),
  redirectMock: vi.fn(),
}));

vi.mock('@/auth', () => ({ auth: authMock }));
vi.mock('@pv/db', () => ({ prisma: { distribuzioneConfig: { upsert: upsertMock } } }));
vi.mock('next/cache', () => ({ revalidatePath: revalidateMock }));
vi.mock('next/navigation', () => ({
  redirect: (...a: unknown[]) => {
    redirectMock(...a);
    throw new Error('NEXT_REDIRECT');
  },
}));

import { salvaConfigDistribuzione } from './actions';
import type { ConfigDistribuzioneInput } from './validate';

/** Input valido di riferimento: 1 km iniziale, +1 km, max 10 km, 60 min per round. */
const INPUT_OK: ConfigDistribuzioneInput = {
  raggioStartKm: 1,
  stepKm: 1,
  raggioMaxKm: 10,
  durataRoundMin: 60,
};

const ADMIN = { user: { id: 'adm', role: 'ADMIN_PIATTAFORMA' } };

beforeEach(() => {
  vi.clearAllMocks();
  upsertMock.mockResolvedValue({ id: 'singleton' });
});

describe('salvaConfigDistribuzione', () => {
  it('rifiuta sessione assente (redirect a /login), nessuna scrittura', async () => {
    authMock.mockResolvedValue(null);
    await expect(salvaConfigDistribuzione(INPUT_OK)).rejects.toThrow('NEXT_REDIRECT');
    expect(redirectMock).toHaveBeenCalledWith('/login');
    expect(upsertMock).not.toHaveBeenCalled();
  });

  it('rifiuta i non ADMIN_PIATTAFORMA, nessuna scrittura', async () => {
    authMock.mockResolvedValue({ user: { id: 'x', role: 'ASSISTENTE' } });
    const res = await salvaConfigDistribuzione(INPUT_OK);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/admin piattaforma/i);
    expect(upsertMock).not.toHaveBeenCalled();
  });

  it('rifiuta raggio massimo < iniziale (cross-field), nessuna scrittura', async () => {
    authMock.mockResolvedValue(ADMIN);

    const res = await salvaConfigDistribuzione({ ...INPUT_OK, raggioStartKm: 5, raggioMaxKm: 2 });

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/maggiore del raggio iniziale/i);
    expect(upsertMock).not.toHaveBeenCalled();
  });

  it('rifiuta raggio massimo == iniziale (non strettamente maggiore), nessuna scrittura', async () => {
    authMock.mockResolvedValue(ADMIN);

    const res = await salvaConfigDistribuzione({ ...INPUT_OK, raggioStartKm: 2, raggioMaxKm: 2 });

    expect(res.ok).toBe(false);
    expect(upsertMock).not.toHaveBeenCalled();
  });

  it('rifiuta raggio massimo sotto il minimo, nessuna scrittura', async () => {
    authMock.mockResolvedValue(ADMIN);

    const res = await salvaConfigDistribuzione({ ...INPUT_OK, raggioStartKm: 0.5, raggioMaxKm: 0.9 });

    expect(res.ok).toBe(false);
    expect(upsertMock).not.toHaveBeenCalled();
  });

  it('rifiuta raggio massimo sopra il massimo, nessuna scrittura', async () => {
    authMock.mockResolvedValue(ADMIN);

    const res = await salvaConfigDistribuzione({ ...INPUT_OK, raggioMaxKm: 100 });

    expect(res.ok).toBe(false);
    expect(upsertMock).not.toHaveBeenCalled();
  });

  // Il cron gira ogni minuto: una durata sotto il minimo non sarebbe rispettabile.
  it('rifiuta una durata round sotto il minimo di 1 minuto, nessuna scrittura', async () => {
    authMock.mockResolvedValue(ADMIN);

    const res = await salvaConfigDistribuzione({ ...INPUT_OK, durataRoundMin: 0 });

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/durata minima/i);
    expect(upsertMock).not.toHaveBeenCalled();
  });

  it('rifiuta una durata round oltre i 60 minuti, nessuna scrittura', async () => {
    authMock.mockResolvedValue(ADMIN);

    const res = await salvaConfigDistribuzione({ ...INPUT_OK, durataRoundMin: 61 });

    expect(res.ok).toBe(false);
    expect(upsertMock).not.toHaveBeenCalled();
  });

  it('rifiuta un campo vuoto (NaN dal form), nessuna scrittura', async () => {
    authMock.mockResolvedValue(ADMIN);

    const res = await salvaConfigDistribuzione({ ...INPUT_OK, stepKm: NaN });

    expect(res.ok).toBe(false);
    expect(upsertMock).not.toHaveBeenCalled();
  });

  it('input valido → upsert sul singleton in metri/minuti e revalida la pagina', async () => {
    authMock.mockResolvedValue(ADMIN);

    const res = await salvaConfigDistribuzione(INPUT_OK);

    expect(res.ok).toBe(true);
    expect(upsertMock).toHaveBeenCalledWith({
      where: { id: 'singleton' },
      create: {
        id: 'singleton',
        raggioStartM: 1000,
        stepM: 1000,
        raggioMaxM: 10000,
        intervalloMin: 60,
      },
      update: {
        raggioStartM: 1000,
        stepM: 1000,
        raggioMaxM: 10000,
        intervalloMin: 60,
      },
    });
    expect(revalidateMock).toHaveBeenCalledWith('/admin/distribuzione');
  });

  // I decimali del form (0,5 km) devono arrivare interi al DB: le colonne
  // sono INTEGER, un float ci finirebbe troncato dal driver. I minuti del
  // round sono già un intero lato form (lo schema li rifiuta, non li arrotonda).
  it('converte i decimali km in interi: 0,5 km → 500 m', async () => {
    authMock.mockResolvedValue(ADMIN);

    const res = await salvaConfigDistribuzione({
      raggioStartKm: 0.5,
      stepKm: 2.5,
      raggioMaxKm: 7.5,
      durataRoundMin: 45,
    });

    expect(res.ok).toBe(true);
    expect(upsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        update: {
          raggioStartM: 500,
          stepM: 2500,
          raggioMaxM: 7500,
          intervalloMin: 45,
        },
      }),
    );
  });
});
