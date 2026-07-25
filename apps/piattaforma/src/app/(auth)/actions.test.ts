import { describe, it, expect, vi, beforeEach } from 'vitest';

const { txMock } = vi.hoisted(() => ({ txMock: vi.fn() }));
vi.mock('@pv/db', () => ({
  prisma: {
    $transaction: txMock,
    company: { findUnique: vi.fn() },
    user: { findMany: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
    verificationToken: {},
    promoCode: { findUnique: vi.fn() },
    promoCodeRedemption: { count: vi.fn() },
    atecoAllowedCode: { findMany: vi.fn().mockResolvedValue([]) },
  },
  // Fittizio ma condiviso: actions.ts ed email-univoca.ts importano ENTRAMBI
  // `Prisma` da questo stesso modulo mockato, quindi `instanceof
  // Prisma.PrismaClientKnownRequestError` combacia in entrambi i punti finché
  // l'errore di test è istanziato con QUESTA classe (vedi describe più sotto
  // "registerAction (catch P2002)").
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
// Rate limit durevole: in test consentiamo sempre di default (deterministico,
// niente stato condiviso/DB reale); i singoli test di throttle sovrascrivono
// con mockResolvedValueOnce({ allowed: false }).
vi.mock('@/lib/rate-limit/durable', () => ({
  rateLimit: vi.fn(() => Promise.resolve({ allowed: true })),
  resetRateLimit: vi.fn(() => Promise.resolve()),
}));
vi.mock('@/lib/rate-limit/client-ip', () => ({
  getClientIp: vi.fn(() => '1.2.3.4'),
}));
// bcrypt.compare/hash mockati per velocità/determinismo: il match di compare
// è pilotato per-test; hash serve solo a superare hashPassword() nel path di
// registrazione, il valore di ritorno è irrilevante.
vi.mock('bcryptjs', () => ({
  default: { compare: vi.fn(), hash: vi.fn().mockResolvedValue('hashed-password') },
}));

import bcrypt from 'bcryptjs';
import { AuthError } from 'next-auth';
import { prisma, Prisma } from '@pv/db';
import { signIn } from '@/auth';
import { rateLimit } from '@/lib/rate-limit/durable';
import { getStorage } from '@/lib/providers/storage';
import {
  loginAction,
  registerAction,
  checkPromoCodeAction,
  requestPasswordResetAction,
} from './actions';

const findFirstMock = vi.mocked(prisma.user.findFirst);
const compareMock = vi.mocked(bcrypt.compare);
const signInMock = vi.mocked(signIn);
const rateLimitMock = vi.mocked(rateLimit);
const getStorageMock = vi.mocked(getStorage);

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

// registerAction legge i documenti da un campo FormData `blobRefs` (JSON di
// {key,name,size,type}), non da File allegati alla Server Action — dal client
// upload su Vercel Blob (limite 4,5 MB sul body serverless, vedi actions.ts
// parseBlobRefs). Valori scelti per passare anche il classificatore
// rule-based (PDF, 200 KB, nome innocuo): CI_FRONTE/CI_RETRO controllano
// hint sul nome, VISURA_CAMERALE richiede PDF.
function fdWith(payload: unknown, opts: { omit?: string } = {}): FormData {
  const fd = new FormData();
  fd.set('payload', JSON.stringify(payload));
  const blobRefs: Record<string, { key: string; name: string; size: number; type: string }> = {};
  for (const slot of [
    'CI_FRONTE',
    'CI_RETRO',
    'CODICE_FISCALE',
    'CODICE_FISCALE_RETRO',
    'VISURA_CAMERALE',
  ]) {
    if (opts.omit === slot) continue;
    blobRefs[slot] = { key: `test-blob-${slot}`, name: 'doc.pdf', size: 200 * 1024, type: 'application/pdf' };
  }
  fd.set('blobRefs', JSON.stringify(blobRefs));
  return fd;
}

// Ogni test riparte da "consentito" (default fail-open-friendly), così i test
// che non riguardano il rate limit non sono influenzati da mockResolvedValueOnce
// lasciati da un test precedente.
beforeEach(() => {
  rateLimitMock.mockReset();
  rateLimitMock.mockResolvedValue({ allowed: true });
});

describe('registerAction (early returns)', () => {
  beforeEach(() => {
    txMock.mockReset();
    vi.mocked(prisma.user.findFirst).mockReset();
    vi.mocked(prisma.user.findFirst).mockResolvedValue(null as never);
  });

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

  it('rifiuta un email gia usata da un utente di un ALTRA azienda', async () => {
    // Il mock simula il DB: esiste un utente con questa email, in un'azienda
    // qualunque. Discrimina sulla `where` — il codice vecchio cerca solo fra
    // gli admin platform (companyId: null) e NON deve trovarlo, altrimenti il
    // test passerebbe anche senza il fix e non proverebbe nulla.
    vi.mocked(prisma.user.findFirst).mockImplementation((async (args: {
      where?: { email?: string; companyId?: string | null };
    }) => {
      const where = args?.where ?? {};
      if (where.email !== 'mario@example.com') return null;
      if (where.companyId === null) return null; // nessun admin platform con quell'email
      return { id: 'u-altra-azienda' };
    }) as never);

    const r = await registerAction(fdWith(validPayload));

    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toBe(
        "Questa email è già registrata. Accedi con l'account esistente o usa un'altra email.",
      );
      expect(r.field).toBe('account.email');
    }
    expect(txMock).not.toHaveBeenCalled();
  });
});

/**
 * Il catch P2002 di registerAction (dopo il check applicativo, chiude la
 * finestra TOCTOU) è l'unica logica nuova del branch email-univoca senza
 * copertura: le altre nove scritture passano da `scriviUtente`, già testato
 * in `email-univoca.test.ts`. Qui si arriva fino alla `prisma.$transaction`
 * (mockata a rigettare direttamente con l'errore fittizio, senza eseguire il
 * callback reale) per esercitare il catch com'è scritto in actions.ts.
 */
describe('registerAction (catch P2002)', () => {
  beforeEach(() => {
    txMock.mockReset();
    vi.mocked(prisma.user.findFirst).mockReset();
    vi.mocked(prisma.user.findFirst).mockResolvedValue(null as never); // email libera al check applicativo
    vi.mocked(prisma.company.findUnique).mockReset();
    vi.mocked(prisma.company.findUnique).mockResolvedValue(null as never); // P.IVA libera al check applicativo
    getStorageMock.mockReset();
    getStorageMock.mockReturnValue({ name: 'vercel-blob' } as never);
  });

  /**
   * `Prisma` in questo file è il mock `{ PrismaClientKnownRequestError: class {} }`
   * dichiarato in cima (vedi vi.mock('@pv/db')) — NON il vero import come in
   * email-univoca.test.ts. Sia `isViolazioneEmailUnica` (email-univoca.ts) sia
   * il check locale in actions.ts leggono `Prisma` dallo STESSO modulo
   * mockato, quindi `instanceof` combacia in entrambi comunque. Ma il
   * costruttore reale è ignorato dal mock (`class {}` non fa nulla con gli
   * argomenti): `code`/`meta` vanno assegnati a mano perché l'istanza sia
   * riconoscibile a runtime.
   */
  function fakeP2002(target: string[] | string) {
    const err = new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
      code: 'P2002',
      clientVersion: '5.22.0',
      meta: { target },
    });
    return Object.assign(err, { code: 'P2002' as const, meta: { target } });
  }

  it('P2002 con target email (race TOCTOU) → EMAIL_GIA_REGISTRATA sul campo account.email', async () => {
    txMock.mockRejectedValueOnce(fakeP2002(['email']));

    const r = await registerAction(fdWith(validPayload));

    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toBe(
        "Questa email è già registrata. Accedi con l'account esistente o usa un'altra email.",
      );
      expect(r.field).toBe('account.email');
    }
  });

  it('P2002 con target partitaIva (race TOCTOU) → errore P.IVA sul campo company.partitaIva', async () => {
    txMock.mockRejectedValueOnce(fakeP2002(['partitaIva']));

    const r = await registerAction(fdWith(validPayload));

    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toBe('P.IVA già registrata');
      expect(r.field).toBe('company.partitaIva');
    }
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

  // Utente fittizio (email univoca: al più un record combacia, vedi
  // activeUserCredentialsQuery). passwordHash è irrilevante perché
  // bcrypt.compare è mockato.
  function utente(twoFactorEnabled: boolean) {
    return { passwordHash: 'hash', twoFactorEnabled };
  }

  beforeEach(() => {
    findFirstMock.mockReset();
    compareMock.mockReset();
    signInMock.mockReset();
  });

  it('utente 2FA + password corretta senza totp → { needTotp: true }, niente signIn', async () => {
    findFirstMock.mockResolvedValue(utente(true) as never);
    compareMock.mockResolvedValue(true as never);

    const r = await loginAction({}, loginForm());

    expect(r).toEqual({ needTotp: true });
    expect(signInMock).not.toHaveBeenCalled();
  });

  it('utente senza 2FA + password corretta → chiama signIn e ritorna {}', async () => {
    findFirstMock.mockResolvedValue(utente(false) as never);
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

  it('password errata → { error: "Credenziali non valide" }, niente signIn', async () => {
    findFirstMock.mockResolvedValue(utente(false) as never);
    compareMock.mockResolvedValue(false as never);

    const r = await loginAction({}, loginForm({ password: 'Sbagliata9' }));

    expect(r).toEqual({ error: 'Credenziali non valide' });
    expect(signInMock).not.toHaveBeenCalled();
  });

  it('account PENDING (email non verificata) + password corretta → { needsEmailVerification, email }, niente signIn', async () => {
    // 1ª query = utenti ATTIVI (vuota: l'account non è ancora ACTIVE).
    // 2ª query = utenti PENDING_EMAIL_VERIFICATION (match sull'email+password).
    findFirstMock
      .mockResolvedValueOnce(null as never)                      // nessun ATTIVO
      .mockResolvedValueOnce({ passwordHash: 'hash' } as never); // uno PENDING
    compareMock.mockResolvedValue(true as never);

    const r = await loginAction({}, loginForm());

    expect(r).toEqual({ needsEmailVerification: true, email: 'mario@example.com' });
    expect(signInMock).not.toHaveBeenCalled();
  });

  it('email sconosciuta (nessun utente attivo né pending) → { error: "Credenziali non valide" }, bcrypt.compare mai chiamato', async () => {
    // Entrambe le query vuote: non si rivela nulla, messaggio generico. E
    // bcrypt.compare deve restare non invocato: è quello a impedire a un
    // attaccante di distinguere per tempistica un'email esistente da una
    // inesistente (invariante di sicurezza, non un vezzo di copertura).
    findFirstMock.mockResolvedValue(null as never);

    const r = await loginAction({}, loginForm());

    expect(r).toEqual({ error: 'Credenziali non valide' });
    expect(signInMock).not.toHaveBeenCalled();
    expect(compareMock).not.toHaveBeenCalled();
  });

  it('utente 2FA + password corretta + totp errato → signIn lancia AuthError → { error: "Codice 2FA non valido", needTotp: true }', async () => {
    findFirstMock.mockResolvedValue(utente(true) as never);
    compareMock.mockResolvedValue(true as never);
    signInMock.mockRejectedValueOnce(new AuthError());

    const r = await loginAction({}, loginForm({ totp: '000000' }));

    expect(r).toEqual({ error: 'Codice 2FA non valido', needTotp: true });
  });

  it('utente senza 2FA + signIn lancia AuthError → { error: "Credenziali non valide" } e needTotp undefined', async () => {
    findFirstMock.mockResolvedValue(utente(false) as never);
    compareMock.mockResolvedValue(true as never);
    signInMock.mockRejectedValueOnce(new AuthError());

    const r = await loginAction({}, loginForm());

    expect(r).toEqual({ error: 'Credenziali non valide' });
    expect(r.needTotp).toBeUndefined();
  });
});

describe('checkPromoCodeAction', () => {
  beforeEach(() => {
    vi.mocked(prisma.promoCode.findUnique).mockReset();
    vi.mocked(prisma.promoCodeRedemption.count).mockReset();
  });

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

  it('throttle: se rateLimit blocca, ritorna "inesistente" senza interrogare il DB (niente enumerazione)', async () => {
    rateLimitMock.mockResolvedValueOnce({ allowed: false });
    const r = await checkPromoCodeAction('BENV10');
    expect(r).toEqual({ stato: 'inesistente' });
    expect(prisma.promoCode.findUnique).not.toHaveBeenCalled();
  });
});

describe('rate limit durevole sulle server action pubbliche', () => {
  beforeEach(() => {
    signInMock.mockReset();
    findFirstMock.mockReset();
    compareMock.mockReset();
    txMock.mockReset();
  });

  function loginForm(): FormData {
    const fd = new FormData();
    fd.set('email', 'mario@example.com');
    fd.set('password', 'Password123');
    return fd;
  }

  it('loginAction: se rateLimit blocca, ritorna l\'errore "troppi tentativi" e non chiama signIn né il lookup utente', async () => {
    rateLimitMock.mockResolvedValueOnce({ allowed: false });

    const r = await loginAction({}, loginForm());

    expect(r.error).toMatch(/Troppi tentativi/);
    expect(signInMock).not.toHaveBeenCalled();
    expect(findFirstMock).not.toHaveBeenCalled();
  });

  it('loginAction: se rateLimit consente, procede normalmente (comportamento invariato)', async () => {
    findFirstMock.mockResolvedValue({ passwordHash: 'hash', twoFactorEnabled: false } as never);
    compareMock.mockResolvedValue(true as never);
    signInMock.mockResolvedValue(undefined as never);

    const r = await loginAction({}, loginForm());

    expect(r).toEqual({});
    expect(signInMock).toHaveBeenCalledTimes(1);
  });

  it('registerAction: se rateLimit blocca, ritorna errore PRIMA di qualunque parsing/transazione', async () => {
    rateLimitMock.mockResolvedValueOnce({ allowed: false });

    const r = await registerAction(new FormData());

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/Troppi tentativi/);
    expect(txMock).not.toHaveBeenCalled();
  });

  it('requestPasswordResetAction: se rateLimit blocca, ritorna { ok: true } senza toccare il DB (stessa forma della risposta "utente inesistente", niente enumeration)', async () => {
    rateLimitMock.mockResolvedValueOnce({ allowed: false });

    const r = await requestPasswordResetAction('vittima@example.com');

    expect(r).toEqual({ ok: true });
    expect(prisma.user.findFirst).not.toHaveBeenCalled();
  });

  it('requestPasswordResetAction: se rateLimit consente ma l\'utente non esiste, ritorna comunque { ok: true } (comportamento invariato)', async () => {
    vi.mocked(prisma.user.findFirst).mockResolvedValue(null as never);

    const r = await requestPasswordResetAction('nessuno@example.com');

    expect(r).toEqual({ ok: true });
  });
});
