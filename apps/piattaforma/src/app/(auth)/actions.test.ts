import { describe, it, expect, vi, beforeEach } from 'vitest';

const { txMock } = vi.hoisted(() => ({ txMock: vi.fn() }));
vi.mock('@pv/db', () => ({
  prisma: {
    $transaction: txMock,
    company: {},
    user: { findMany: vi.fn(), update: vi.fn() },
    verificationToken: {},
    promoCode: { findUnique: vi.fn() },
    promoCodeRedemption: { count: vi.fn() },
    atecoAllowedCode: { findMany: vi.fn().mockResolvedValue([]) },
  },
  Prisma: { PrismaClientKnownRequestError: class {} },
}));
vi.mock('next-auth', () => ({ AuthError: class AuthError extends Error {} }));
vi.mock('@/auth', () => ({ signIn: vi.fn(), signOut: vi.fn() }));
vi.mock('@/env', () => ({ env: { DEMO_MODE: true } }));
vi.mock('next/headers', () => ({
  headers: async () => new Map(),
  // `delete`: loginAction cancella il cookie della modale affiliazione prima di
  // signIn(), così ogni login la ripropone a chi non ha spuntato "non mostrare più".
  cookies: async () => ({ get: () => undefined, delete: () => undefined }),
}));
vi.mock('@/lib/crm/sync', () => ({ tryMatchCrmContact: vi.fn() }));
vi.mock('@/lib/affiliazione/notifications', () => ({ notifyReferralSignup: vi.fn() }));
vi.mock('@/lib/providers/storage', () => ({ getStorage: vi.fn() }));
vi.mock('@/lib/providers/registro-imprese', () => ({ getRegistroImprese: vi.fn() }));
// Rate limit: in test consentiamo sempre (deterministico, niente stato condiviso).
vi.mock('@/lib/auth/rate-limit', () => ({
  checkRateLimit: vi.fn(() => ({ allowed: true, remaining: 5 })),
  resetRateLimit: vi.fn(),
}));
// bcrypt.compare mockato per velocità/determinismo: il match è pilotato per-test.
vi.mock('bcryptjs', () => ({
  default: { compare: vi.fn() },
}));

import bcrypt from 'bcryptjs';
import { AuthError } from 'next-auth';
import { prisma } from '@pv/db';
import { signIn } from '@/auth';
import { loginAction, registerAction, checkPromoCodeAction } from './actions';

const findManyMock = vi.mocked(prisma.user.findMany);
const compareMock = vi.mocked(bcrypt.compare);
const signInMock = vi.mocked(signIn);

const validPayload = {
  account: {
    email: 'mario@example.com',
    password: 'Password123',
    passwordConfirm: 'Password123',
    nome: 'Mario',
    cognome: 'Rossi',
    codiceFiscale: 'RSSMRA80A01H501U',
    dataNascita: '1980-01-01',
    luogoNascita: 'Roma',
  },
  company: {
    type: 'DEALER',
    ragioneSociale: 'Rossi Auto',
    partitaIva: '12345678901',
    codiceSdi: 'ABC1234',
    pec: 'rossi@pec.it',
    email: 'info@rossi.it',
    telefono: '+39 06 1234567',
    indirizzo: 'Via Roma',
    civico: '1',
    citta: 'Roma',
    cap: '00100',
    provincia: 'RM',
    regimeFiscale: 'ORDINARIO',
  },
  payment: {
    iban: 'IT60X0542811101000000123456',
    sepaMandateAccepted: true,
    termsAccepted: true,
    clausoleVessatorieAccepted: true,
  },
};

function makeFile(): File {
  return new File([new Uint8Array(200 * 1024)], 'doc.pdf', { type: 'application/pdf' });
}

function fdWith(payload: unknown, opts: { omit?: string } = {}): FormData {
  const fd = new FormData();
  fd.set('payload', JSON.stringify(payload));
  for (const slot of ['CI_FRONTE', 'CI_RETRO', 'CODICE_FISCALE', 'VISURA_CAMERALE']) {
    if (opts.omit === slot) continue;
    fd.set(slot, makeFile());
  }
  return fd;
}

describe('registerAction (early returns)', () => {
  beforeEach(() => txMock.mockReset());

  it('fallisce se manca il payload', async () => {
    const r = await registerAction(new FormData());
    expect(r.ok).toBe(false);
    expect(txMock).not.toHaveBeenCalled();
  });

  it('fallisce se manca un documento', async () => {
    const r = await registerAction(fdWith(validPayload, { omit: 'CODICE_FISCALE' }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('tutti i documenti');
    expect(txMock).not.toHaveBeenCalled();
  });
});

describe('loginAction', () => {
  function loginForm(opts: { email?: string; password?: string; totp?: string } = {}): FormData {
    const fd = new FormData();
    fd.set('email', opts.email ?? 'mario@example.com');
    fd.set('password', opts.password ?? 'Password123');
    if (opts.totp !== undefined) fd.set('totp', opts.totp);
    return fd;
  }

  // Candidate fittizio: passwordHash è irrilevante perché bcrypt.compare è mockato.
  function candidate(twoFactorEnabled: boolean) {
    return { passwordHash: 'hash', twoFactorEnabled };
  }

  beforeEach(() => {
    findManyMock.mockReset();
    compareMock.mockReset();
    signInMock.mockReset();
  });

  it('utente 2FA + password corretta senza totp → { needTotp: true }, niente signIn', async () => {
    findManyMock.mockResolvedValue([candidate(true)] as never);
    compareMock.mockResolvedValue(true as never);

    const r = await loginAction({}, loginForm());

    expect(r).toEqual({ needTotp: true });
    expect(signInMock).not.toHaveBeenCalled();
  });

  it('utente senza 2FA + password corretta → chiama signIn e ritorna {}', async () => {
    findManyMock.mockResolvedValue([candidate(false)] as never);
    compareMock.mockResolvedValue(true as never);
    signInMock.mockResolvedValue(undefined as never);

    const r = await loginAction({}, loginForm());

    expect(r).toEqual({});
    expect(signInMock).toHaveBeenCalledTimes(1);
    expect(signInMock).toHaveBeenCalledWith(
      'credentials',
      expect.objectContaining({
        email: 'mario@example.com',
        password: 'Password123',
        redirectTo: '/dashboard',
      }),
    );
  });

  it('password errata (nessun candidate combacia) → { error: "Credenziali non valide" }, niente signIn', async () => {
    findManyMock.mockResolvedValue([candidate(false)] as never);
    compareMock.mockResolvedValue(false as never);

    const r = await loginAction({}, loginForm({ password: 'Sbagliata9' }));

    expect(r).toEqual({ error: 'Credenziali non valide' });
    expect(signInMock).not.toHaveBeenCalled();
  });

  it('utente 2FA + password corretta + totp errato → signIn lancia AuthError → { error: "Codice 2FA non valido", needTotp: true }', async () => {
    findManyMock.mockResolvedValue([candidate(true)] as never);
    compareMock.mockResolvedValue(true as never);
    signInMock.mockRejectedValueOnce(new AuthError());

    const r = await loginAction({}, loginForm({ totp: '000000' }));

    expect(r).toEqual({ error: 'Codice 2FA non valido', needTotp: true });
  });

  it('utente senza 2FA + signIn lancia AuthError → { error: "Credenziali non valide" } e needTotp undefined', async () => {
    findManyMock.mockResolvedValue([candidate(false)] as never);
    compareMock.mockResolvedValue(true as never);
    signInMock.mockRejectedValueOnce(new AuthError());

    const r = await loginAction({}, loginForm());

    expect(r).toEqual({ error: 'Credenziali non valide' });
    expect(r.needTotp).toBeUndefined();
  });
});

describe('checkPromoCodeAction', () => {
  it('codice inesistente', async () => {
    vi.mocked(prisma.promoCode.findUnique).mockResolvedValue(null as never);
    const r = await checkPromoCodeAction('NOPE');
    expect(r).toEqual({ stato: 'inesistente' });
  });
  it('codice valido ritorna importo', async () => {
    vi.mocked(prisma.promoCode.findUnique).mockResolvedValue({ id: 'p1', amountCent: 5000, expiresAt: null, active: true, maxRedemptions: null } as never);
    vi.mocked(prisma.promoCodeRedemption.count).mockResolvedValue(0 as never);
    const r = await checkPromoCodeAction(' benv ');
    expect(r).toEqual({ stato: 'valido', amountCent: 5000 });
  });
});
