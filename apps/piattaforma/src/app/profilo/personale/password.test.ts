import { describe, it, expect, vi, beforeEach } from 'vitest';

const { authMock, prismaMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  prismaMock: {
    user: { findUnique: vi.fn(), findFirst: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
  },
}));

vi.mock('@pv/db', () => ({ prisma: prismaMock }));
vi.mock('@/auth', () => ({ auth: authMock, unstable_update: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({
  redirect: vi.fn(() => {
    throw new Error('NEXT_REDIRECT');
  }),
}));
// bcrypt mockato per velocità: `compare` è pilotato per-test, `hash` è deterministico.
// La policy (validatePasswordPolicy) resta quella vera.
vi.mock('bcryptjs', () => ({
  default: { compare: vi.fn(), hash: vi.fn(async () => 'NUOVO_HASH') },
}));

import bcrypt from 'bcryptjs';
import { changeOwnPasswordAction } from './actions';

const compareMock = vi.mocked(bcrypt.compare);

const ME = { id: 'u1', email: 'mario@example.com', passwordHash: 'HASH_ATTUALE' };

beforeEach(() => {
  vi.clearAllMocks();
  authMock.mockResolvedValue({ user: { id: 'u1' } });
  prismaMock.user.findUnique.mockResolvedValue(ME);
});

/** `compare(plain, hash)`: true solo per la password indicata come "quella in DB". */
function passwordInDb(attuale: string): void {
  compareMock.mockImplementation(async (plain: string) => plain === attuale);
}

describe('changeOwnPasswordAction', () => {
  it('password attuale sbagliata → rifiuta e non scrive', async () => {
    passwordInDb('Vecchia123');

    const res = await changeOwnPasswordAction('Sbagliata123', 'Nuova1234');

    expect(res).toEqual({ ok: false, error: 'La password attuale non è corretta' });
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it('nuova password fuori policy → rifiuta e non scrive', async () => {
    passwordInDb('Vecchia123');

    const corta = await changeOwnPasswordAction('Vecchia123', 'Abc1');
    const senzaNumeri = await changeOwnPasswordAction('Vecchia123', 'solominuscole');

    expect(corta.ok).toBe(false);
    expect(senzaNumeri.ok).toBe(false);
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it('nuova password uguale alla attuale → rifiuta e non scrive', async () => {
    passwordInDb('Vecchia123');

    const res = await changeOwnPasswordAction('Vecchia123', 'Vecchia123');

    expect(res).toEqual({
      ok: false,
      error: 'La nuova password deve essere diversa da quella attuale',
    });
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it('happy path → nuovo hash sull\'account della sessione (update by id, email univoca)', async () => {
    passwordInDb('Vecchia123');

    const res = await changeOwnPasswordAction('Vecchia123', 'Nuova1234');

    expect(res).toEqual({ ok: true });
    expect(prismaMock.user.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { passwordHash: 'NUOVO_HASH' },
    });
  });

  it('sessione assente → redirect al login, nessuna scrittura', async () => {
    authMock.mockResolvedValue(null);

    await expect(changeOwnPasswordAction('x', 'Nuova1234')).rejects.toThrow('NEXT_REDIRECT');
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });
});
