import { describe, it, expect, vi, beforeEach } from 'vitest';

const { getSessionContextMock, prismaMock } = vi.hoisted(() => ({
  getSessionContextMock: vi.fn(),
  prismaMock: {
    user: { findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    invitation: { findFirst: vi.fn(), create: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    company: { findUnique: vi.fn(() => Promise.resolve({ ragioneSociale: 'Acme' })) },
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

import { createUserDirectAction } from './actions';

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
      isOwner: false,
      accessibleSedi: [sede('s1')],
      membershipRuoli: { s1: 'ADMIN_SEDE' },
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
      isOwner: false,
      accessibleSedi: [sede('s1')],
      membershipRuoli: { s1: 'OPERATORE' },
    });
    const res = await createUserDirectAction('x@y.it', 'Ann', 'Bee', 'Password1', 's1', 'OPERATORE');
    expect(res.ok).toBe(false);
    expect(prismaMock.user.create).not.toHaveBeenCalled();
  });

  it('ADMIN_SEDE non può creare su una sede che non amministra', async () => {
    getSessionContextMock.mockResolvedValue({
      user: { id: 'u1', role: 'UTENTE_AZIENDA' },
      companyId: 'c1',
      isOwner: false,
      accessibleSedi: [sede('s1'), sede('s2')],
      membershipRuoli: { s1: 'ADMIN_SEDE', s2: 'OPERATORE' },
    });
    const res = await createUserDirectAction('x@y.it', 'Ann', 'Bee', 'Password1', 's2', 'OPERATORE');
    expect(res.ok).toBe(false);
    expect(prismaMock.user.create).not.toHaveBeenCalled();
  });
});
