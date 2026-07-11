import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * La sanzione anti-abuso non deve essere revocabile dal sanzionato. Prima lo
 * era: `setSedeSuspended` scriveva `suspendedAt: null` per chiunque fosse
 * ADMIN_AZIENDA della propria azienda, e sospensione volontaria e sanzione
 * condividevano lo stesso campo. L'agenzia auto-sospesa per 5 no-show apriva
 * /sedi/[id], cliccava "Riattiva" e rientrava in distribuzione.
 */

const { prismaMock, authMock, redirectMock } = vi.hoisted(() => ({
  prismaMock: {
    sede: { findUnique: vi.fn(), update: vi.fn() },
  },
  authMock: vi.fn(),
  redirectMock: vi.fn((url: string) => {
    throw new Error(`__REDIRECT__:${url}`);
  }),
}));

vi.mock('@pv/db', () => ({ prisma: prismaMock }));
vi.mock('@/auth', () => ({ auth: authMock }));
vi.mock('next/navigation', () => ({ redirect: redirectMock }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { reactivateSedeAction, suspendSedeAction } from './actions';

const SEDE = 'sede-1';
const COMPANY = 'company-1';

beforeEach(() => {
  vi.clearAllMocks();
  authMock.mockResolvedValue({
    user: { id: 'u-1', role: 'ADMIN_AZIENDA', companyId: COMPANY },
  });
  prismaMock.sede.update.mockResolvedValue({});
});

describe('suspendSedeAction — sanzione anti-abuso (exploit a due chiamate)', () => {
  /**
   * CRITICAL 2 (review finale branch): la guardia copriva solo il ramo di
   * RIATTIVAZIONE. Il ramo di SOSPENSIONE non era guardato e riscriveva
   * `suspensionOrigin: 'UTENTE'` anche su una sede già sospesa dall'anti-abuso.
   * Exploit in due chiamate, entrambe server action raggiungibili dal browser:
   *   1. suspendSedeAction(sedeId) su una sede già ANTI_ABUSO → l'unico
   *      effetto era ANTI_ABUSO -> UTENTE.
   *   2. reactivateSedeAction(sedeId) → ora passava la guardia → il
   *      sanzionato rientrava in distribuzione.
   * `sede.update` non deve MAI essere chiamato su una sede già ANTI_ABUSO, in
   * nessuna delle due direzioni.
   */
  it('sede già sospesa dall_ANTI_ABUSO: suspendSedeAction è rifiutata, update NON chiamato', async () => {
    prismaMock.sede.findUnique.mockResolvedValue({
      companyId: COMPANY,
      suspensionOrigin: 'ANTI_ABUSO',
    });

    const res = await suspendSedeAction(SEDE);

    expect(res.ok).toBe(false);
    expect(prismaMock.sede.update).not.toHaveBeenCalled();
  });
});

describe('reactivateSedeAction — sanzione anti-abuso', () => {
  it('sede sospesa dall_ANTI_ABUSO: l_utente NON può riattivarla', async () => {
    prismaMock.sede.findUnique.mockResolvedValue({
      companyId: COMPANY,
      suspensionOrigin: 'ANTI_ABUSO',
    });

    const res = await reactivateSedeAction(SEDE);

    expect(res.ok).toBe(false);
    expect(prismaMock.sede.update).not.toHaveBeenCalled();
  });

  it('sede sospesa dall_UTENTE: la può riattivare da sé', async () => {
    prismaMock.sede.findUnique.mockResolvedValue({
      companyId: COMPANY,
      suspensionOrigin: 'UTENTE',
    });

    const res = await reactivateSedeAction(SEDE);

    expect(res).toEqual({ ok: true });
    expect(prismaMock.sede.update).toHaveBeenCalledWith({
      where: { id: SEDE },
      data: { suspendedAt: null, suspensionOrigin: null },
    });
  });

  it('sospensione volontaria: marca origine UTENTE', async () => {
    prismaMock.sede.findUnique.mockResolvedValue({
      companyId: COMPANY,
      suspensionOrigin: null,
    });

    const res = await suspendSedeAction(SEDE);

    expect(res).toEqual({ ok: true });
    expect(prismaMock.sede.update).toHaveBeenCalledWith({
      where: { id: SEDE },
      data: { suspendedAt: expect.any(Date), suspensionOrigin: 'UTENTE' },
    });
  });
});
