import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Rilievo N6 (review finale pre-merge): `reactivateSedeAntiAbusoAction`
 * riattivava QUALUNQUE sede passata per id, anche una sospesa volontariamente
 * dal titolare (es. per ferie, `suspensionOrigin: 'UTENTE'`). Non è una falla
 * di sicurezza (azione admin-only, la UI mostra il bottone solo per sedi
 * ANTI_ABUSO), ma scavalcherebbe per errore una scelta organizzativa
 * dell'utente. L'azione ora si rifiuta se la sede non è sospesa
 * dall'anti-abuso.
 */

const SEDE_ID = 'sede-1';

const { authMock, prismaMock, redirectMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  prismaMock: {
    sede: { findUnique: vi.fn(), update: vi.fn() },
  },
  redirectMock: vi.fn((url: string) => {
    throw new Error(`__REDIRECT__:${url}`);
  }),
}));

vi.mock('@pv/db', () => ({ prisma: prismaMock }));
vi.mock('@/auth', () => ({ auth: authMock }));
vi.mock('next/navigation', () => ({ redirect: redirectMock }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { reactivateSedeAntiAbusoAction } from './suspension-actions';

beforeEach(() => {
  vi.clearAllMocks();
  authMock.mockResolvedValue({ user: { id: 'admin-1', role: 'ADMIN_PIATTAFORMA' } });
  prismaMock.sede.update.mockResolvedValue({});
});

describe('reactivateSedeAntiAbusoAction — scope alla sola sanzione anti-abuso', () => {
  it('sede sospesa da ANTI_ABUSO → riattivata', async () => {
    prismaMock.sede.findUnique.mockResolvedValue({ suspensionOrigin: 'ANTI_ABUSO' });

    const res = await reactivateSedeAntiAbusoAction(SEDE_ID);

    expect(res).toEqual({ ok: true });
    expect(prismaMock.sede.update).toHaveBeenCalledWith({
      where: { id: SEDE_ID, suspensionOrigin: 'ANTI_ABUSO' },
      data: { suspendedAt: null, suspensionOrigin: null },
    });
  });

  it('sede sospesa volontariamente dal titolare (UTENTE) → NON riattivata, update mai chiamato', async () => {
    prismaMock.sede.findUnique.mockResolvedValue({ suspensionOrigin: 'UTENTE' });

    const res = await reactivateSedeAntiAbusoAction(SEDE_ID);

    expect(res.ok).toBe(false);
    expect(prismaMock.sede.update).not.toHaveBeenCalled();
  });

  it('sede non sospesa (suspensionOrigin null) → NON riattivata, update mai chiamato', async () => {
    prismaMock.sede.findUnique.mockResolvedValue({ suspensionOrigin: null });

    const res = await reactivateSedeAntiAbusoAction(SEDE_ID);

    expect(res.ok).toBe(false);
    expect(prismaMock.sede.update).not.toHaveBeenCalled();
  });

  it('sede inesistente → rifiutata, update mai chiamato', async () => {
    prismaMock.sede.findUnique.mockResolvedValue(null);

    const res = await reactivateSedeAntiAbusoAction(SEDE_ID);

    expect(res.ok).toBe(false);
    expect(prismaMock.sede.update).not.toHaveBeenCalled();
  });

  it('ruolo non admin/assistente → rifiutata prima di interrogare il DB', async () => {
    authMock.mockResolvedValue({ user: { id: 'u-2', role: 'AGENZIA' } });

    const res = await reactivateSedeAntiAbusoAction(SEDE_ID);

    expect(res.ok).toBe(false);
    expect(prismaMock.sede.findUnique).not.toHaveBeenCalled();
    expect(prismaMock.sede.update).not.toHaveBeenCalled();
  });
});
