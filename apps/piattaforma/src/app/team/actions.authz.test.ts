import { describe, it, expect, vi, beforeEach } from 'vitest';

const { getSessionContextMock, prismaMock } = vi.hoisted(() => ({
  getSessionContextMock: vi.fn(),
  prismaMock: {
    user: { findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    invitation: { findFirst: vi.fn(), create: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    company: { findUnique: vi.fn(() => Promise.resolve({ ragioneSociale: 'Acme' })) },
    sede: { findFirst: vi.fn() },
    userSede: { create: vi.fn(), findFirst: vi.fn(), deleteMany: vi.fn(), update: vi.fn() },
    $transaction: vi.fn(async (cb: (t: unknown) => unknown) => cb(prismaMock)),
  },
}));

vi.mock('@pv/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/auth/session-context', async (orig) => {
  const actual = (await orig()) as object;
  return { ...actual, getSessionContext: getSessionContextMock };
});
vi.mock('@/auth', () => ({ auth: vi.fn(() => Promise.resolve({ user: { id: 'u1' } })) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/providers/email', () => ({ getEmail: () => ({ send: vi.fn(() => Promise.resolve()) }) }));
vi.mock('@/lib/auth/password', () => ({ hashPassword: vi.fn(() => Promise.resolve('hash')) }));

import {
  createUserDirectAction,
  updateTeamUserAction,
  disableTeamUserAction,
  revokeInvitationAction,
} from './actions';

const sede = (id: string) => ({ id, nome: id, type: 'AGENZIA' as const });

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.user.findFirst.mockResolvedValue(null); // nessun duplicato email
  prismaMock.user.create.mockResolvedValue({ id: 'new-user-id' }); // usato da tx.user.create(...).id
});

describe('createUserDirectAction — autorizzazione sede-aware', () => {
  it('ADMIN_SEDE crea un OPERATORE nella propria sede', async () => {
    getSessionContextMock.mockResolvedValue({
      user: { id: 'u1', role: 'UTENTE_AZIENDA' },
      companyId: 'c1',
      companyType: 'AGENZIA',
      isOwner: false,
      accessibleSedi: [sede('s1')],
      membershipRuoli: { s1: 'ADMIN_SEDE' },
      permessi: new Set(['team.view', 'team.crea', 'team.modifica', 'team.disabilita', 'team.permessi']),
    });
    const res = await createUserDirectAction('x@y.it', 'Ann', 'Bee', 'Password1', 's1', 'OPERATORE');
    expect(res).toEqual({ ok: true });
    expect(prismaMock.userSede.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ sedeId: 's1', ruolo: 'OPERATORE' }) }),
    );
  });

  it('OPERATORE non può creare account', async () => {
    getSessionContextMock.mockResolvedValue({
      user: { id: 'u1', role: 'UTENTE_AZIENDA' },
      companyId: 'c1',
      companyType: 'AGENZIA',
      isOwner: false,
      accessibleSedi: [sede('s1')],
      membershipRuoli: { s1: 'OPERATORE' },
      permessi: new Set(),
    });
    const res = await createUserDirectAction('x@y.it', 'Ann', 'Bee', 'Password1', 's1', 'OPERATORE');
    expect(res.ok).toBe(false);
    expect(prismaMock.user.create).not.toHaveBeenCalled();
  });

  it('ADMIN_SEDE non può creare su una sede che non amministra', async () => {
    getSessionContextMock.mockResolvedValue({
      user: { id: 'u1', role: 'UTENTE_AZIENDA' },
      companyId: 'c1',
      companyType: 'AGENZIA',
      isOwner: false,
      accessibleSedi: [sede('s1'), sede('s2')],
      membershipRuoli: { s1: 'ADMIN_SEDE', s2: 'OPERATORE' },
      permessi: new Set(['team.view', 'team.crea', 'team.modifica', 'team.disabilita', 'team.permessi']),
    });
    const res = await createUserDirectAction('x@y.it', 'Ann', 'Bee', 'Password1', 's2', 'OPERATORE');
    expect(res.ok).toBe(false);
    expect(prismaMock.user.create).not.toHaveBeenCalled();
  });
});

describe('updateTeamUserAction — autorizzazione sede-aware (target esistente)', () => {
  it('ADMIN_SEDE non può spostare un utente su una sede che non amministra', async () => {
    getSessionContextMock.mockResolvedValue({
      user: { id: 'u1', role: 'UTENTE_AZIENDA' },
      companyId: 'c1',
      companyType: 'AGENZIA',
      isOwner: false,
      accessibleSedi: [sede('s1'), sede('s2')],
      membershipRuoli: { s1: 'ADMIN_SEDE', s2: 'OPERATORE' },
      permessi: new Set(['team.view', 'team.crea', 'team.modifica', 'team.disabilita', 'team.permessi']),
    });
    // Target è un UTENTE_AZIENDA con membership in s1 → authorizeTeamTargetUser passa.
    prismaMock.user.findUnique.mockResolvedValue({
      id: 'target1',
      companyId: 'c1',
      role: 'UTENTE_AZIENDA',
      email: 'a@y.it',
    });
    prismaMock.userSede.findFirst.mockResolvedValue({ id: 'us1' }); // membership in una sede gestita
    prismaMock.sede.findFirst.mockResolvedValue({ id: 's2' }); // la sede destinazione esiste nell'azienda

    // Richiede lo spostamento su s2, che l'ADMIN_SEDE di s1 NON gestisce.
    const res = await updateTeamUserAction('target1', 'a@y.it', 'Ann', 'Bee', 's2', 'OPERATORE');
    expect(res.ok).toBe(false);
    expect(prismaMock.userSede.create).not.toHaveBeenCalled();
    expect(prismaMock.userSede.update).not.toHaveBeenCalled();
    expect(prismaMock.userSede.deleteMany).not.toHaveBeenCalled();
  });
});

describe('disableTeamUserAction — autorizzazione sede-aware (target esistente)', () => {
  it('ADMIN_SEDE non può disabilitare il proprietario (nessuna membership → non gestibile)', async () => {
    getSessionContextMock.mockResolvedValue({
      user: { id: 'u1', role: 'UTENTE_AZIENDA' },
      companyId: 'c1',
      companyType: 'AGENZIA',
      isOwner: false,
      accessibleSedi: [sede('s1')],
      membershipRuoli: { s1: 'ADMIN_SEDE' },
      permessi: new Set(['team.view', 'team.crea', 'team.modifica', 'team.disabilita', 'team.permessi']),
    });
    // Target è il proprietario: ADMIN_AZIENDA, senza UserSede.
    prismaMock.user.findUnique.mockResolvedValue({
      id: 'owner1',
      companyId: 'c1',
      role: 'ADMIN_AZIENDA',
    });
    prismaMock.userSede.findFirst.mockResolvedValue(null); // owner: nessuna membership

    const res = await disableTeamUserAction('owner1');
    expect(res.ok).toBe(false);
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });
});

describe('revokeInvitationAction — autorizzazione sede-aware (invito)', () => {
  it('ADMIN_SEDE non può revocare un invito di una sede che non amministra', async () => {
    getSessionContextMock.mockResolvedValue({
      user: { id: 'u1', role: 'UTENTE_AZIENDA' },
      companyId: 'c1',
      companyType: 'AGENZIA',
      isOwner: false,
      accessibleSedi: [sede('s1')],
      membershipRuoli: { s1: 'ADMIN_SEDE' },
      permessi: new Set(['team.view', 'team.crea', 'team.modifica', 'team.disabilita', 'team.permessi']),
    });
    // Invito PENDING per la sede s2, non gestita dall'ADMIN_SEDE di s1.
    prismaMock.invitation.findUnique.mockResolvedValue({
      id: 'inv1',
      companyId: 'c1',
      status: 'PENDING',
      sedeId: 's2',
    });

    await revokeInvitationAction('inv1');
    expect(prismaMock.invitation.update).not.toHaveBeenCalled();
  });
});
