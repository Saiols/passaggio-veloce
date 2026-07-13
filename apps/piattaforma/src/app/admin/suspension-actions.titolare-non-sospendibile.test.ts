import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * CRITICAL C2 (review finale pre-merge, ultima ondata): `suspendUserAction`
 * non aveva alcun guard sul ruolo del target. Il bottone "Sospendi" è
 * renderizzato per ogni utente non-ADMIN_PIATTAFORMA, incluso l'ADMIN_AZIENDA
 * (il titolare) — che nel caso standard (registrazione) è l'UNICA utenza
 * dell'azienda. Sospenderlo lasciava l'azienda senza alcun accesso mentre
 * `Company.suspendedAt` restava `null`: la sede continuava a ricevere
 * assegnazioni, portando a 5 timeout e quindi all'auto-sospensione
 * anti-abuso (clausola 12.2) per un lockout causato da noi. La clausola
 * 12.3-bis promette invece che "l'account aziendale e le altre utenze
 * restano pienamente operativi".
 *
 * Fix: il target ADMIN_AZIENDA è ora rifiutato con un messaggio che rimanda
 * alla sospensione dell'intero account (clausola 12.3).
 */

const USER_ID = 'user-1';

const { authMock, prismaMock, redirectMock, sendNotificationMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  prismaMock: {
    user: { update: vi.fn(), findUnique: vi.fn() },
  },
  redirectMock: vi.fn((url: string) => {
    throw new Error(`__REDIRECT__:${url}`);
  }),
  sendNotificationMock: vi.fn(() => Promise.resolve()),
}));

vi.mock('@pv/db', () => ({ prisma: prismaMock }));
vi.mock('@/auth', () => ({ auth: authMock }));
vi.mock('next/navigation', () => ({ redirect: redirectMock }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/notifiche', () => ({ sendNotification: sendNotificationMock }));

import { suspendUserAction } from './suspension-actions';

beforeEach(() => {
  vi.clearAllMocks();
  authMock.mockResolvedValue({ user: { id: 'admin-1', role: 'ADMIN_PIATTAFORMA' } });
  prismaMock.user.update.mockResolvedValue({});
});

describe('suspendUserAction — il titolare (ADMIN_AZIENDA) non è sospendibile singolarmente', () => {
  it('target ADMIN_AZIENDA → rifiutata, user.update MAI chiamato, nessuna email', async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: USER_ID,
      role: 'ADMIN_AZIENDA',
      email: 'titolare@agenzia-monoutente.it',
      nome: 'Mario',
      companyId: 'company-1',
      company: { ragioneSociale: 'Agenzia Mono Srl' },
    });

    const res = await suspendUserAction(USER_ID, 'Mancata risposta a solleciti.');

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toMatch(/titolare/i);
      expect(res.error).toMatch(/12\.3/);
    }
    expect(prismaMock.user.update).not.toHaveBeenCalled();
    expect(sendNotificationMock).not.toHaveBeenCalled();
  });

  it('utente inesistente → rifiutata, user.update mai chiamato', async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);

    const res = await suspendUserAction(USER_ID, 'Motivo qualsiasi');

    expect(res.ok).toBe(false);
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it('target NON-titolare (UTENTE_AZIENDA) → sospensione eseguita normalmente (non regredire)', async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: USER_ID,
      role: 'UTENTE_AZIENDA',
      email: 'dipendente@agenzia.it',
      nome: 'Luigi',
      companyId: 'company-1',
      company: { ragioneSociale: 'Agenzia Multi Srl' },
    });

    const res = await suspendUserAction(USER_ID, 'Mancata risposta a solleciti.');

    expect(res).toEqual({ ok: true });
    expect(prismaMock.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: USER_ID },
        data: expect.objectContaining({ status: 'SUSPENDED' }),
      }),
    );
    expect(sendNotificationMock).toHaveBeenCalledWith(
      expect.objectContaining({
        tipo: 'N45_UTENTE_SOSPESO',
        target: expect.objectContaining({ email: 'dipendente@agenzia.it' }),
      }),
    );
  });
});
