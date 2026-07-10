import { describe, it, expect, vi, beforeEach } from 'vitest';

const { getSessionContextMock, prismaMock } = vi.hoisted(() => ({
  getSessionContextMock: vi.fn(),
  prismaMock: {
    user: { findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    invitation: { findFirst: vi.fn(), create: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    company: { findUnique: vi.fn(() => Promise.resolve({ ragioneSociale: 'Acme', type: 'AGENZIA' })) },
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
  createInvitationAction,
  updateTeamUserAction,
  acceptInvitationAction,
  resetTeamUserPasswordAction,
  disableTeamUserAction,
  revokeInvitationAction,
} from './actions';

const sede = (id: string) => ({ id, nome: id, type: 'AGENZIA' as const });

const ctxAdminSede = (permessi: string[]) => ({
  user: { id: 'admin1', role: 'UTENTE_AZIENDA' },
  companyId: 'c1',
  companyType: 'AGENZIA' as const,
  isOwner: false,
  accessibleSedi: [sede('s1')],
  membershipRuoli: { s1: 'ADMIN_SEDE' as const },
  permessi: new Set(permessi),
});

const ctxOwner = () => ({
  user: { id: 'owner1', role: 'ADMIN_AZIENDA' },
  companyId: 'c1',
  companyType: 'AGENZIA' as const,
  isOwner: true,
  accessibleSedi: [sede('s1')],
  membershipRuoli: {},
  permessi: new Set<string>(),
});

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.user.findFirst.mockResolvedValue(null);
  prismaMock.user.create.mockResolvedValue({ id: 'new-user-id' });
});

describe('createUserDirectAction — permessi', () => {
  it("l'owner crea un utente con i permessi richiesti", async () => {
    getSessionContextMock.mockResolvedValue(ctxOwner());
    const res = await createUserDirectAction(
      'x@y.it', 'Ann', 'Bee', 'Password1', 's1', 'OPERATORE',
      ['pratiche.view', 'pratiche.firma'],
    );
    expect(res).toEqual({ ok: true });
    expect(prismaMock.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ permessi: ['pratiche.firma', 'pratiche.view'] }),
      }),
    );
  });

  it('un admin di sede non può concedere un permesso che non ha', async () => {
    getSessionContextMock.mockResolvedValue(
      ctxAdminSede(['team.view', 'team.crea', 'team.permessi', 'pratiche.view']),
    );
    const res = await createUserDirectAction(
      'x@y.it', 'Ann', 'Bee', 'Password1', 's1', 'OPERATORE',
      ['pratiche.view', 'pratiche.firma'],
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain('pratiche.firma');
    expect(prismaMock.user.create).not.toHaveBeenCalled();
  });

  it('chi non ha team.crea non crea nemmeno con permessi validi', async () => {
    getSessionContextMock.mockResolvedValue(ctxAdminSede(['team.view']));
    const res = await createUserDirectAction(
      'x@y.it', 'Ann', 'Bee', 'Password1', 's1', 'OPERATORE', ['pratiche.view'],
    );
    expect(res.ok).toBe(false);
    expect(prismaMock.user.create).not.toHaveBeenCalled();
  });

  it('chi ha team.crea ma non team.permessi crea col preset base intersecato ai propri', async () => {
    getSessionContextMock.mockResolvedValue(
      ctxAdminSede(['team.view', 'team.crea', 'pratiche.view', 'pratiche.processa', 'notifiche.view']),
    );
    const res = await createUserDirectAction('x@y.it', 'Ann', 'Bee', 'Password1', 's1', 'OPERATORE');
    expect(res).toEqual({ ok: true });
    expect(prismaMock.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          permessi: ['notifiche.view', 'pratiche.processa', 'pratiche.view'],
        }),
      }),
    );
  });
});

describe('updateTeamUserAction — permessi', () => {
  beforeEach(() => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: 'target1', companyId: 'c1', role: 'UTENTE_AZIENDA', email: 'a@y.it',
    });
    prismaMock.userSede.findFirst.mockResolvedValue({ id: 'us1', sedeId: 's1' });
    prismaMock.sede.findFirst.mockResolvedValue({ id: 's1' });
  });

  it('nessuno modifica i propri permessi', async () => {
    getSessionContextMock.mockResolvedValue(
      ctxAdminSede(['team.view', 'team.modifica', 'team.permessi', 'pratiche.view']),
    );
    prismaMock.user.findUnique.mockResolvedValue({
      id: 'admin1', companyId: 'c1', role: 'UTENTE_AZIENDA', email: 'admin@y.it',
    });
    const res = await updateTeamUserAction(
      'admin1', 'admin@y.it', 'Ad', 'Min', 's1', 'ADMIN_SEDE', ['pratiche.view'],
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain('tuoi permessi');
  });

  it("nessuno modifica i permessi dell'owner", async () => {
    getSessionContextMock.mockResolvedValue(ctxOwner());
    prismaMock.user.findUnique.mockResolvedValue({
      id: 'owner1', companyId: 'c1', role: 'ADMIN_AZIENDA', email: 'own@y.it',
    });
    const res = await updateTeamUserAction(
      'owner1', 'own@y.it', 'Ow', 'Ner', 's1', 'ADMIN_SEDE', ['pratiche.view'],
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain('titolare');
  });

  it('omettere i permessi lascia intatti quelli esistenti', async () => {
    getSessionContextMock.mockResolvedValue(ctxOwner());
    const res = await updateTeamUserAction('target1', 'a@y.it', 'Ann', 'Bee', 's1', 'OPERATORE');
    expect(res.ok).toBe(true);
    const dati = prismaMock.user.update.mock.calls[0]?.[0]?.data ?? {};
    expect(dati).not.toHaveProperty('permessi');
  });
});

describe('createUserDirectAction — escalation con solo team.crea (senza team.permessi)', () => {
  it('la richiesta esplicita di un permesso extra viene ignorata, non applicata: niente escalation', async () => {
    // Senza team.permessi, permessiPerNuovoUtente ignora `richiesti` e ricade sul
    // preset base intersecato ai permessi del chiamante (comportamento di check.ts,
    // Task 3). Il punto del test: 'pratiche.firma' — che il chiamante non ha —
    // non deve MAI comparire nel set salvato, nonostante sia stato richiesto.
    getSessionContextMock.mockResolvedValue(
      ctxAdminSede(['team.view', 'team.crea', 'pratiche.view']),
    );
    const res = await createUserDirectAction(
      'x@y.it', 'Ann', 'Bee', 'Password1', 's1', 'OPERATORE',
      ['pratiche.view', 'pratiche.firma'],
    );
    expect(res).toEqual({ ok: true });
    expect(prismaMock.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ permessi: ['pratiche.view'] }),
      }),
    );
  });
});

describe('createInvitationAction — permessi', () => {
  it('senza team.invita non crea inviti', async () => {
    getSessionContextMock.mockResolvedValue(ctxAdminSede(['team.view', 'team.crea']));
    const res = await createInvitationAction('x@y.it', 's1', 'OPERATORE', ['pratiche.view']);
    expect(res.ok).toBe(false);
    expect(prismaMock.invitation.create).not.toHaveBeenCalled();
  });

  it('con team.invita ma senza team.permessi la richiesta esplicita viene ignorata, non applicata', async () => {
    getSessionContextMock.mockResolvedValue(
      ctxAdminSede(['team.view', 'team.invita', 'pratiche.view']),
    );
    const res = await createInvitationAction(
      'x@y.it', 's1', 'OPERATORE', ['pratiche.view', 'pratiche.firma'],
    );
    expect(res.ok).toBe(true);
    expect(prismaMock.invitation.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ permessi: ['pratiche.view'] }) }),
    );
  });

  it('con team.invita e team.permessi salva i permessi richiesti sull’invito', async () => {
    getSessionContextMock.mockResolvedValue(
      ctxAdminSede(['team.view', 'team.invita', 'team.permessi', 'pratiche.view']),
    );
    const res = await createInvitationAction('x@y.it', 's1', 'OPERATORE', ['pratiche.view']);
    expect(res.ok).toBe(true);
    expect(prismaMock.invitation.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ permessi: ['pratiche.view'] }) }),
    );
  });
});

describe('gate di capability — lo scope ok non basta senza il permesso specifico', () => {
  beforeEach(() => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: 'target1', companyId: 'c1', role: 'UTENTE_AZIENDA', email: 'a@y.it', deletedAt: null,
    });
    prismaMock.userSede.findFirst.mockResolvedValue({ id: 'us1', sedeId: 's1' });
  });

  it('resetTeamUserPasswordAction senza team.reset_password viene bloccato', async () => {
    getSessionContextMock.mockResolvedValue(ctxAdminSede(['team.view']));
    const res = await resetTeamUserPasswordAction('target1');
    expect(res.ok).toBe(false);
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it('disableTeamUserAction senza team.disabilita viene bloccato', async () => {
    getSessionContextMock.mockResolvedValue(ctxAdminSede(['team.view']));
    const res = await disableTeamUserAction('target1');
    expect(res.ok).toBe(false);
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it('revokeInvitationAction senza team.disabilita viene bloccato', async () => {
    getSessionContextMock.mockResolvedValue(ctxAdminSede(['team.view']));
    const res = await revokeInvitationAction('inv1');
    expect(res.ok).toBe(false);
    expect(prismaMock.invitation.update).not.toHaveBeenCalled();
  });
});

describe('acceptInvitationAction — porta i permessi scelti al momento dell’invito', () => {
  it("il nuovo utente nasce con i permessi dell'invito", async () => {
    prismaMock.invitation.findUnique.mockResolvedValue({
      id: 'inv1',
      companyId: 'c1',
      email: 'nuovo@y.it',
      status: 'PENDING',
      sedeId: 's1',
      ruoloSede: 'OPERATORE',
      permessi: ['pratiche.view', 'inbox.view', 'inbox.gestisci'],
      expiresAt: new Date(Date.now() + 86_400_000),
    });
    // Firma reale: acceptInvitationAction(token, nome, cognome, password).
    const res = await acceptInvitationAction('token-valido', 'Ann', 'Bee', 'Password1');
    expect(res.ok).toBe(true);
    expect(prismaMock.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          permessi: ['pratiche.view', 'inbox.view', 'inbox.gestisci'],
        }),
      }),
    );
  });
});
