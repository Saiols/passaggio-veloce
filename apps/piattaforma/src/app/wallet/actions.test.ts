import { describe, it, expect, vi, beforeEach } from 'vitest';

const { authMock, getOperatingSedeMock, prismaMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  getOperatingSedeMock: vi.fn(),
  prismaMock: {
    wallet: { findUnique: vi.fn() },
    payout: { findFirst: vi.fn(), create: vi.fn() },
    mandatoFatturazione: { findUnique: vi.fn() },
  },
}));

vi.mock('@/auth', () => ({ auth: authMock }));
vi.mock('@/lib/auth/session-context', () => ({ getOperatingSede: getOperatingSedeMock }));
vi.mock('@pv/db', () => ({ prisma: prismaMock }));
vi.mock('next/navigation', () => ({ redirect: (u: string) => { throw new Error('REDIRECT:' + u); } }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { richiediPayoutAction } from './actions';

beforeEach(() => {
  vi.clearAllMocks();
  authMock.mockResolvedValue({ user: { companyType: 'DEALER', companyId: 'c1' } });
  getOperatingSedeMock.mockResolvedValue({ id: 's1' });
  prismaMock.wallet.findUnique.mockResolvedValue({ id: 'w1', saldoCent: 80_000 });
  prismaMock.payout.findFirst.mockResolvedValue(null);
  prismaMock.payout.create.mockResolvedValue({});
});

describe('richiediPayoutAction — gate mandato', () => {
  it('senza mandato → requireMandato, niente payout', async () => {
    prismaMock.mandatoFatturazione.findUnique.mockResolvedValue(null);
    const r = await richiediPayoutAction();
    expect(r).toEqual({ ok: false, requireMandato: true });
    expect(prismaMock.payout.create).not.toHaveBeenCalled();
  });
  it('con mandato → crea il payout', async () => {
    prismaMock.mandatoFatturazione.findUnique.mockResolvedValue({ id: 'm1' });
    const r = await richiediPayoutAction();
    expect(r).toEqual({ ok: true });
    expect(prismaMock.payout.create).toHaveBeenCalledTimes(1);
  });
});
