import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Rilievo N2 (review finale pre-merge): la clausola 11.3 dei Termini dice
 * "la sospensione è comunicata via email con indicazione del motivo", ma la
 * nota era etichettata "opzionale" e `sanitizeNote` restituiva `null` se
 * vuota → il template N14 ometteva il blocco "Motivo:" e il diritto di
 * riesame previsto dalla stessa clausola restava svuotato (l'utente non
 * saprebbe cosa contestare).
 *
 * Fix: il motivo è ora obbligatorio per `suspendCompanyAction`, rifiutato con
 * un errore chiaro se vuoto dopo il trim. La nota di RIATTIVAZIONE
 * (`reactivateCompanyAction`) resta legittimamente facoltativa — non è
 * coperta dalla stessa clausola.
 */

const COMPANY_ID = 'company-1';

const { authMock, prismaMock, redirectMock, sendNotificationMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  prismaMock: {
    company: { update: vi.fn(), findUnique: vi.fn() },
    user: { updateMany: vi.fn() },
    $transaction: vi.fn((ops: unknown[]) => Promise.all(ops)),
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

import { suspendCompanyAction, reactivateCompanyAction } from './suspension-actions';

beforeEach(() => {
  vi.clearAllMocks();
  authMock.mockResolvedValue({ user: { id: 'admin-1', role: 'ADMIN_PIATTAFORMA' } });
  prismaMock.company.update.mockResolvedValue({});
  prismaMock.user.updateMany.mockResolvedValue({ count: 1 });
  prismaMock.company.findUnique.mockResolvedValue({
    id: COMPANY_ID,
    ragioneSociale: 'Test SRL',
    users: [{ id: 'u1', email: 'u1@test.it', nome: 'Mario' }],
  });
});

describe('suspendCompanyAction — motivo obbligatorio (clausola 11.3)', () => {
  it('nota assente (undefined) → rifiutata, nessuna scrittura DB, nessuna email', async () => {
    const res = await suspendCompanyAction(COMPANY_ID, undefined);

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/obbligatori/i);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    expect(prismaMock.company.update).not.toHaveBeenCalled();
    expect(sendNotificationMock).not.toHaveBeenCalled();
  });

  it('nota vuota ("") → rifiutata', async () => {
    const res = await suspendCompanyAction(COMPANY_ID, '');

    expect(res.ok).toBe(false);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('nota di soli spazi ("   ") → rifiutata dopo il trim', async () => {
    const res = await suspendCompanyAction(COMPANY_ID, '   ');

    expect(res.ok).toBe(false);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('nota valorizzata → sospensione eseguita, nota salvata e inclusa nella notifica', async () => {
    const res = await suspendCompanyAction(COMPANY_ID, 'Mancata risposta a segnalazioni ripetute.');

    expect(res).toEqual({ ok: true });
    expect(prismaMock.company.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: COMPANY_ID },
        data: expect.objectContaining({
          suspendedAt: expect.any(Date),
          suspensionLastNote: 'Mancata risposta a segnalazioni ripetute.',
        }),
      }),
    );
    expect(sendNotificationMock).toHaveBeenCalledWith(
      expect.objectContaining({
        tipo: 'N14_ACCOUNT_SOSPESO',
        payload: expect.objectContaining({ motivo: 'Mancata risposta a segnalazioni ripetute.' }),
      }),
    );
  });

  it('ruolo non admin/assistente → rifiutata prima ancora di validare la nota', async () => {
    authMock.mockResolvedValue({ user: { id: 'u-2', role: 'AGENZIA' } });

    const res = await suspendCompanyAction(COMPANY_ID, undefined);

    expect(res.ok).toBe(false);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });
});

describe('reactivateCompanyAction — la nota resta facoltativa (non regredire)', () => {
  it('nessuna nota → riattivazione comunque eseguita', async () => {
    const res = await reactivateCompanyAction(COMPANY_ID, undefined);

    expect(res).toEqual({ ok: true });
    expect(prismaMock.company.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: COMPANY_ID },
        data: { suspendedAt: null, suspensionLastNote: null },
      }),
    );
  });

  it('con nota → riattivazione eseguita e nota salvata', async () => {
    const res = await reactivateCompanyAction(COMPANY_ID, 'KYC completato.');

    expect(res).toEqual({ ok: true });
    expect(prismaMock.company.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { suspendedAt: null, suspensionLastNote: 'KYC completato.' },
      }),
    );
  });
});
