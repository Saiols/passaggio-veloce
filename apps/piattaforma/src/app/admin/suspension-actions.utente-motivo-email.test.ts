import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Rilievo CRITICAL 2 (review finale pre-merge, ultima ondata prima del
 * merge): `suspendUserAction` sospende la SINGOLA utenza di un'azienda
 * cliente ma non inviava alcuna email né richiedeva un motivo — una quarta
 * misura limitativa non prevista dalla clausola 11 dei Termini, che
 * dichiarava "tre misure... elencate in modo tassativo". Decisione del
 * titolare: la misura resta nel prodotto e viene descritta nel contratto
 * (clausola 11.3-bis) come misura VERA — quindi il codice deve onorarla:
 * motivo obbligatorio + email all'utente sospeso con indicazione del motivo,
 * stesso pattern già applicato a `suspendCompanyAction` (N14/clausola 11.3).
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
  prismaMock.user.findUnique.mockResolvedValue({
    id: USER_ID,
    email: 'mario@agenzia.it',
    nome: 'Mario',
    company: { ragioneSociale: 'Agenzia Rossi Srl' },
  });
  prismaMock.user.update.mockResolvedValue({});
});

describe('suspendUserAction — motivo obbligatorio (clausola 11.3-bis)', () => {
  it('nota assente (undefined) → rifiutata, nessuna scrittura DB, nessuna email', async () => {
    const res = await suspendUserAction(USER_ID, undefined);

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/obbligatori/i);
    expect(prismaMock.user.update).not.toHaveBeenCalled();
    expect(sendNotificationMock).not.toHaveBeenCalled();
  });

  it('nota vuota ("") → rifiutata', async () => {
    const res = await suspendUserAction(USER_ID, '');

    expect(res.ok).toBe(false);
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it('nota di soli spazi ("   ") → rifiutata dopo il trim', async () => {
    const res = await suspendUserAction(USER_ID, '   ');

    expect(res.ok).toBe(false);
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it('nota valorizzata → sospensione eseguita, nota salvata e inviata via email all\'utente', async () => {
    const res = await suspendUserAction(USER_ID, 'Mancata risposta a solleciti ripetuti.');

    expect(res).toEqual({ ok: true });
    expect(prismaMock.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: USER_ID },
        data: expect.objectContaining({
          status: 'SUSPENDED',
          suspensionLastNote: 'Mancata risposta a solleciti ripetuti.',
        }),
      }),
    );
    expect(sendNotificationMock).toHaveBeenCalledWith(
      expect.objectContaining({
        tipo: 'N45_UTENTE_SOSPESO',
        target: expect.objectContaining({ email: 'mario@agenzia.it', userId: USER_ID }),
        payload: expect.objectContaining({
          nomeUtente: 'Mario',
          ragioneSociale: 'Agenzia Rossi Srl',
          motivo: 'Mancata risposta a solleciti ripetuti.',
        }),
      }),
    );
  });

  it('ruolo non admin/assistente → rifiutata prima ancora di validare la nota', async () => {
    authMock.mockResolvedValue({ user: { id: 'u-2', role: 'AGENZIA' } });

    const res = await suspendUserAction(USER_ID, undefined);

    expect(res.ok).toBe(false);
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it('non puo\' sospendere se stesso, anche con motivo valido', async () => {
    authMock.mockResolvedValue({ user: { id: USER_ID, role: 'ADMIN_PIATTAFORMA' } });

    const res = await suspendUserAction(USER_ID, 'Motivo qualsiasi');

    expect(res.ok).toBe(false);
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });
});
