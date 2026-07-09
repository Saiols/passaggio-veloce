import { describe, it, expect, vi, beforeEach } from 'vitest';

const { getOperatingSedeMock, getSedeRoleMock, eseguiPayoutMock, prismaMock } = vi.hoisted(() => ({
  getOperatingSedeMock: vi.fn(),
  getSedeRoleMock: vi.fn(),
  eseguiPayoutMock: vi.fn(() => Promise.resolve({ ok: true })),
  prismaMock: {
    wallet: { findUnique: vi.fn() },
    mandatoFatturazione: { findUnique: vi.fn(() => Promise.resolve({ id: 'm1' })) },
  },
}));

vi.mock('@pv/db', () => ({ prisma: prismaMock }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect: vi.fn() }));
vi.mock('@/auth', () => ({
  auth: vi.fn(() =>
    Promise.resolve({ user: { id: 'u1', role: 'UTENTE_AZIENDA', companyId: 'c1', companyType: 'DEALER' } }),
  ),
}));
vi.mock('@/lib/auth/session-context', async (orig) => {
  const actual = (await orig()) as object;
  return { ...actual, getOperatingSede: getOperatingSedeMock, getSedeRole: getSedeRoleMock };
});
vi.mock('@/lib/wallet/payout-exec', () => ({ eseguiPayoutImmediato: eseguiPayoutMock }));

import { richiediPayoutAction } from './actions';

const SEDE = { id: 's1', nome: 'Filiale', type: 'DEALER' as const };

beforeEach(() => {
  vi.clearAllMocks();
  getOperatingSedeMock.mockResolvedValue(SEDE);
  // Saldo ampiamente sopra la soglia minima: il gate NON deve dipendere dal saldo.
  prismaMock.wallet.findUnique.mockResolvedValue({ id: 'w1', saldoCent: 100_000_00 });
  prismaMock.mandatoFatturazione.findUnique.mockResolvedValue({ id: 'm1' });
  eseguiPayoutMock.mockResolvedValue({ ok: true });
});

describe('richiediPayoutAction — chi può incassare', () => {
  it('operatore di sede: rifiutato, e NESSUN payout viene eseguito', async () => {
    getSedeRoleMock.mockResolvedValue('OPERATORE');

    const res = await richiediPayoutAction();

    expect(res).toEqual({ ok: false, error: expect.stringContaining('permessi') });
    expect(eseguiPayoutMock).not.toHaveBeenCalled();
  });

  it('admin della sede: ammesso', async () => {
    getSedeRoleMock.mockResolvedValue('ADMIN_SEDE');

    await expect(richiediPayoutAction()).resolves.toEqual({ ok: true });
    expect(eseguiPayoutMock).toHaveBeenCalledTimes(1);
  });

  it('proprietario: ammesso', async () => {
    getSedeRoleMock.mockResolvedValue('OWNER');

    await expect(richiediPayoutAction()).resolves.toEqual({ ok: true });
  });

  it('nessuna sede selezionata: rifiutato prima di leggere qualunque wallet', async () => {
    getOperatingSedeMock.mockResolvedValue(null);

    const res = await richiediPayoutAction();

    expect(res).toEqual({ ok: false, error: expect.stringContaining('Seleziona una sede') });
    expect(prismaMock.wallet.findUnique).not.toHaveBeenCalled();
    expect(eseguiPayoutMock).not.toHaveBeenCalled();
  });

  it('il gate viene valutato sulla sede operativa', async () => {
    getSedeRoleMock.mockResolvedValue('ADMIN_SEDE');

    await richiediPayoutAction();

    expect(getSedeRoleMock).toHaveBeenCalledWith('s1');
  });
});
