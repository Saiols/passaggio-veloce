import { describe, it, expect, vi, beforeEach } from 'vitest';

const { getOperatingSedeMock, getSessionContextMock, eseguiPayoutMock, prismaMock } = vi.hoisted(() => ({
  getOperatingSedeMock: vi.fn(),
  getSessionContextMock: vi.fn(),
  eseguiPayoutMock: vi.fn(() => Promise.resolve({ ok: true })),
  prismaMock: {
    wallet: { findUnique: vi.fn() },
    mandatoFatturazione: { findUnique: vi.fn(() => Promise.resolve({ id: 'm1' })) },
    sede: { update: vi.fn() },
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
  return { ...actual, getOperatingSede: getOperatingSedeMock, getSessionContext: getSessionContextMock };
});
vi.mock('@/lib/wallet/payout-exec', () => ({ eseguiPayoutImmediato: eseguiPayoutMock }));

import { richiediPayoutAction, updatePayoutThresholdAction } from './actions';

const SEDE = { id: 's1', nome: 'Filiale', type: 'DEALER' as const };

/** Contesto di sessione con i permessi indicati. `isOwner` sovrascrivibile per i casi owner-bypass. */
const ctxConPermessi = (permessi: string[], overrides: Record<string, unknown> = {}) => ({
  user: { id: 'u1', role: 'UTENTE_AZIENDA' },
  companyId: 'c1',
  companyType: 'DEALER' as const,
  isOwner: false,
  accessibleSedi: [SEDE],
  currentSede: { kind: 'ONE' as const, sede: SEDE },
  scopeIds: ['s1'],
  membershipRuoli: { s1: 'OPERATORE' as const },
  permessi: new Set(permessi),
  sospensione: { sospeso: false, motivo: null, origine: null },
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  getOperatingSedeMock.mockResolvedValue(SEDE);
  getSessionContextMock.mockResolvedValue(
    ctxConPermessi(['wallet.view', 'wallet.payout', 'wallet.soglia']),
  );
  // Saldo ampiamente sopra la soglia minima: il gate NON deve dipendere dal saldo.
  prismaMock.wallet.findUnique.mockResolvedValue({ id: 'w1', saldoCent: 100_000_00 });
  prismaMock.mandatoFatturazione.findUnique.mockResolvedValue({ id: 'm1' });
  eseguiPayoutMock.mockResolvedValue({ ok: true });
});

describe('richiediPayoutAction — capability', () => {
  it('un admin di sede senza wallet.payout non preleva', async () => {
    getSessionContextMock.mockResolvedValue(ctxConPermessi(['wallet.view']));

    const res = await richiediPayoutAction();

    expect(res).toEqual({ ok: false, error: expect.stringContaining('permessi') });
    expect(eseguiPayoutMock).not.toHaveBeenCalled();
  });

  it('con wallet.payout: ammesso', async () => {
    getSessionContextMock.mockResolvedValue(ctxConPermessi(['wallet.view', 'wallet.payout']));

    await expect(richiediPayoutAction()).resolves.toEqual({ ok: true });
    expect(eseguiPayoutMock).toHaveBeenCalledTimes(1);
  });

  it('proprietario: ammesso anche senza permessi espliciti (isOwner bypassa)', async () => {
    getSessionContextMock.mockResolvedValue(ctxConPermessi([], { isOwner: true }));

    await expect(richiediPayoutAction()).resolves.toEqual({ ok: true });
  });

  it('nessuna sede selezionata: rifiutato prima di leggere qualunque wallet', async () => {
    getOperatingSedeMock.mockResolvedValue(null);

    const res = await richiediPayoutAction();

    expect(res).toEqual({ ok: false, error: expect.stringContaining('Seleziona una sede') });
    expect(prismaMock.wallet.findUnique).not.toHaveBeenCalled();
    expect(eseguiPayoutMock).not.toHaveBeenCalled();
  });

  it('senza wallet.payout: il gate blocca PRIMA di risolvere la sede operativa (permesso prima dello scope)', async () => {
    getSessionContextMock.mockResolvedValue(ctxConPermessi(['wallet.view']));

    await richiediPayoutAction();

    expect(getOperatingSedeMock).not.toHaveBeenCalled();
  });
});

describe('updatePayoutThresholdAction — capability', () => {
  const validThresholdCent = 150_000;

  it('senza wallet.soglia: rifiutato, sede.update NON chiamato', async () => {
    getSessionContextMock.mockResolvedValue(ctxConPermessi(['wallet.view']));

    const res = await updatePayoutThresholdAction(validThresholdCent);

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain('permessi');
    expect(prismaMock.sede.update).not.toHaveBeenCalled();
  });

  it('con wallet.soglia: ammesso, sede.update chiamato', async () => {
    getSessionContextMock.mockResolvedValue(ctxConPermessi(['wallet.view', 'wallet.soglia']));

    const res = await updatePayoutThresholdAction(validThresholdCent);

    expect(res.ok).toBe(true);
    expect(prismaMock.sede.update).toHaveBeenCalledTimes(1);
  });

  it('proprietario: ammesso anche senza permessi espliciti (isOwner bypassa)', async () => {
    getSessionContextMock.mockResolvedValue(ctxConPermessi([], { isOwner: true }));

    const res = await updatePayoutThresholdAction(validThresholdCent);

    expect(res.ok).toBe(true);
  });

  it('senza wallet.soglia: il gate blocca PRIMA di risolvere la sede operativa', async () => {
    getSessionContextMock.mockResolvedValue(ctxConPermessi(['wallet.view']));

    await updatePayoutThresholdAction(validThresholdCent);

    expect(getOperatingSedeMock).not.toHaveBeenCalled();
  });
});
