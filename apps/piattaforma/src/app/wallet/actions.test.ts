import { describe, it, expect, vi, beforeEach } from 'vitest';

const { authMock, getOperatingSedeMock, getSedeRoleMock, prismaMock, eseguiPayoutMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  getOperatingSedeMock: vi.fn(),
  getSedeRoleMock: vi.fn(),
  prismaMock: {
    wallet: { findUnique: vi.fn() },
    mandatoFatturazione: { findUnique: vi.fn() },
    sede: { update: vi.fn() },
  },
  eseguiPayoutMock: vi.fn(),
}));

vi.mock('@/auth', () => ({ auth: authMock }));
vi.mock('@/lib/auth/session-context', () => ({
  getOperatingSede: getOperatingSedeMock,
  getSedeRole: getSedeRoleMock,
}));
vi.mock('@pv/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/wallet/payout-exec', () => ({ eseguiPayoutImmediato: eseguiPayoutMock }));
vi.mock('next/navigation', () => ({ redirect: (u: string) => { throw new Error('REDIRECT:' + u); } }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { richiediPayoutAction, updatePayoutThresholdAction } from './actions';

beforeEach(() => {
  vi.clearAllMocks();
  authMock.mockResolvedValue({ user: { companyType: 'DEALER', companyId: 'c1' } });
  getOperatingSedeMock.mockResolvedValue({ id: 's1' });
  // Default: titolare della sede. I test su richiediPayoutAction in questo file
  // coprono mandato/esecuzione/R5, non il gate di ruolo (coperto in
  // actions.authz.test.ts) — i test su updatePayoutThresholdAction più sotto
  // sovrascrivono questo mock per-caso.
  getSedeRoleMock.mockResolvedValue('ADMIN_SEDE');
  // Wallet di sede eleggibile; nessun wallet madre (broker senza affiliazione).
  prismaMock.wallet.findUnique.mockImplementation(({ where }: { where: { sedeId?: string; companyId?: string } }) =>
    Promise.resolve(where.sedeId ? { id: 'w1', saldoCent: 80_000 } : null),
  );
  eseguiPayoutMock.mockResolvedValue({ ok: true, payoutId: 'p1', importoCent: 80_000 });
});

describe('richiediPayoutAction — gate mandato + esecuzione istantanea', () => {
  it('senza mandato → requireMandato, nessuna esecuzione', async () => {
    prismaMock.mandatoFatturazione.findUnique.mockResolvedValue(null);
    const r = await richiediPayoutAction();
    expect(r).toEqual({ ok: false, requireMandato: true });
    expect(eseguiPayoutMock).not.toHaveBeenCalled();
  });
  it('con mandato → esegue subito il payout del wallet eleggibile', async () => {
    prismaMock.mandatoFatturazione.findUnique.mockResolvedValue({ id: 'm1' });
    const r = await richiediPayoutAction();
    expect(r).toEqual({ ok: true });
    expect(eseguiPayoutMock).toHaveBeenCalledTimes(1);
    expect(eseguiPayoutMock).toHaveBeenCalledWith('w1', { automatico: false });
  });
  it('saldo sotto soglia su tutti i wallet → errore, nessuna esecuzione', async () => {
    prismaMock.wallet.findUnique.mockImplementation(({ where }: { where: { sedeId?: string; companyId?: string } }) =>
      Promise.resolve(where.sedeId ? { id: 'w1', saldoCent: 10_000 } : null),
    );
    prismaMock.mandatoFatturazione.findUnique.mockResolvedValue({ id: 'm1' });
    const r = await richiediPayoutAction();
    expect(r).toEqual({ ok: false, error: 'Saldo sotto la soglia minima di 500€' });
    expect(eseguiPayoutMock).not.toHaveBeenCalled();
  });
});

describe('richiediPayoutAction — wallet madre riservato al proprietario (R5)', () => {
  beforeEach(() => {
    // Entrambi i wallet eleggibili: sede 80_000, madre 90_000.
    prismaMock.wallet.findUnique.mockImplementation(({ where }: { where: { sedeId?: string; companyId?: string } }) =>
      Promise.resolve(
        where.sedeId
          ? { id: 'w1', saldoCent: 80_000 }
          : where.companyId
            ? { id: 'wMadre', saldoCent: 90_000 }
            : null,
      ),
    );
    prismaMock.mandatoFatturazione.findUnique.mockResolvedValue({ id: 'm1' });
  });

  it('non-owner (UTENTE_AZIENDA) → incassa solo il wallet sede, mai il wallet madre', async () => {
    authMock.mockResolvedValue({
      user: { companyType: 'DEALER', companyId: 'c1', role: 'UTENTE_AZIENDA' },
    });
    const r = await richiediPayoutAction();
    expect(r).toEqual({ ok: true });
    expect(eseguiPayoutMock).toHaveBeenCalledTimes(1);
    expect(eseguiPayoutMock).toHaveBeenCalledWith('w1', { automatico: false });
    expect(eseguiPayoutMock).not.toHaveBeenCalledWith('wMadre', expect.anything());
  });

  it('owner (ADMIN_AZIENDA) → incassa sia il wallet sede sia il wallet madre', async () => {
    authMock.mockResolvedValue({
      user: { companyType: 'DEALER', companyId: 'c1', role: 'ADMIN_AZIENDA' },
    });
    const r = await richiediPayoutAction();
    expect(r).toEqual({ ok: true });
    expect(eseguiPayoutMock).toHaveBeenCalledTimes(2);
    expect(eseguiPayoutMock).toHaveBeenCalledWith('w1', { automatico: false });
    expect(eseguiPayoutMock).toHaveBeenCalledWith('wMadre', { automatico: false });
  });
});

describe('updatePayoutThresholdAction — gate autorizzazione impostazioni sede', () => {
  // thresholdCent valido (dentro AUTO_PAYOUT_MIN/MAX_CENT), riusato anche nei
  // casi DENY: se il gate `canEditSedeSettings` venisse rimosso, il valore
  // supererebbe la validazione e arriverebbe a `prisma.sede.update`, quindi
  // i test DENY restano una guardia reale sul gate.
  const validThresholdCent = 150_000;

  it('OPERATORE → negato, sede.update NON chiamato', async () => {
    getSedeRoleMock.mockResolvedValue('OPERATORE');
    const res = await updatePayoutThresholdAction(validThresholdCent);
    expect(res.ok).toBe(false);
    expect(prismaMock.sede.update).not.toHaveBeenCalled();
  });

  it('sede non accessibile (ruolo null) → negato, sede.update NON chiamato', async () => {
    getSedeRoleMock.mockResolvedValue(null);
    const res = await updatePayoutThresholdAction(validThresholdCent);
    expect(res.ok).toBe(false);
    expect(prismaMock.sede.update).not.toHaveBeenCalled();
  });

  it('ADMIN_SEDE → consentito, sede.update chiamato', async () => {
    getSedeRoleMock.mockResolvedValue('ADMIN_SEDE');
    const res = await updatePayoutThresholdAction(validThresholdCent);
    expect(res.ok).toBe(true);
    expect(prismaMock.sede.update).toHaveBeenCalledTimes(1);
  });
});
