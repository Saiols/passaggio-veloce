import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Gate di CAPABILITY (`inbox.gestisci`) su `acceptPratica`/`rejectPratica`.
 * Autenticazione → permesso → scope: il gate precede sia `isAgenziaBloccata`
 * sia la lettura dell'assegnazione (nessuna riga letta/scritta se negato).
 *
 * `acceptAndRedirect`/`rejectAndRedirect` sono wrapper puri: chiamano
 * `acceptPratica`/`rejectPratica` e ne propagano l'esito in un redirect. Non
 * duplicano la logica di gate — verificato leggendo il codice — quindi gatare
 * solo le due funzioni "core" basta a coprire anche i wrapper.
 */

const { prismaMock, authMock, getSessionContextMock, redirectMock, visuraScadutaMock } = vi.hoisted(() => ({
  prismaMock: {
    praticaAssegnazione: { findFirst: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    pratica: { findUnique: vi.fn(), update: vi.fn() },
    $transaction: vi.fn(async (cb: (t: unknown) => unknown) => cb(prismaMock)),
  },
  authMock: vi.fn(),
  getSessionContextMock: vi.fn(),
  redirectMock: vi.fn((url: string) => {
    throw new Error(`__REDIRECT__:${url}`);
  }),
  visuraScadutaMock: vi.fn(),
}));

vi.mock('@pv/db', () => ({ prisma: prismaMock }));
vi.mock('@/auth', () => ({ auth: authMock }));
vi.mock('@/lib/auth/session-context', async (orig) => {
  const actual = (await orig()) as object;
  return { ...actual, getSessionContext: getSessionContextMock };
});
vi.mock('next/navigation', () => ({ redirect: redirectMock }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/distribuzione', () => ({ tickPratica: vi.fn(() => Promise.resolve()) }));
vi.mock('@/lib/notifiche', () => ({
  sendNotification: vi.fn(() => Promise.resolve()),
  notifyClientiAvanzamento: vi.fn(() => Promise.resolve()),
}));
vi.mock('@/lib/notifiche/pratica', () => ({ destinatariBroker: vi.fn(() => Promise.resolve([])) }));
vi.mock('@/lib/fee/blocco', () => ({ isAgenziaBloccata: vi.fn(() => Promise.resolve(false)) }));
vi.mock('@/lib/visura/stato', () => ({ isVisuraScadutaCompany: visuraScadutaMock }));
vi.mock('@/lib/eventi/emit', () => ({
  emitEventoPratica: vi.fn(() => Promise.resolve()),
  dismissNuovaPraticaEventi: vi.fn(() => Promise.resolve()),
}));
vi.mock('@/lib/eventi/pratica-eventi', () => ({ eventoPraticaAccettata: vi.fn(() => ({})) }));

import { acceptPratica, rejectPratica, acceptAndRedirect, rejectAndRedirect } from './actions';

const PID = 'p1';
const AGENZIA = 'ag-1';
const SEDE_MIA = 'sede-mia';

/** Contesto di sessione con i permessi indicati. */
function ctxConPermessi(permessi: string[], overrides: Record<string, unknown> = {}) {
  return {
    user: { id: 'u1', companyId: AGENZIA, companyType: 'AGENZIA', role: 'OPERATORE' },
    companyId: AGENZIA,
    companyType: 'AGENZIA' as const,
    isOwner: false,
    accessibleSedi: [{ id: SEDE_MIA, nome: 'Mia', type: 'AGENZIA' }],
    currentSede: { kind: 'ONE', sede: { id: SEDE_MIA, nome: 'Mia', type: 'AGENZIA' } },
    scopeIds: [SEDE_MIA],
    membershipRuoli: { [SEDE_MIA]: 'OPERATORE' },
    permessi: new Set(permessi),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  authMock.mockResolvedValue({
    user: { id: 'u1', companyId: AGENZIA, companyType: 'AGENZIA', role: 'OPERATORE' },
  });
  getSessionContextMock.mockResolvedValue(ctxConPermessi(['inbox.view', 'inbox.gestisci']));
  prismaMock.$transaction.mockImplementation(async (cb: (t: unknown) => unknown) => cb(prismaMock));
  // Default: visura non scaduta, mai bloccata. Il test dedicato sotto la
  // sovrascrive a `true`.
  visuraScadutaMock.mockResolvedValue(false);
});

describe('acceptPratica — capability', () => {
  it('un operatore senza inbox.gestisci non accetta', async () => {
    getSessionContextMock.mockResolvedValue(ctxConPermessi(['inbox.view']));

    const res = await acceptPratica(PID);

    expect(res).toEqual({ ok: false, error: 'Non hai i permessi per questa azione' });
    expect(prismaMock.praticaAssegnazione.update).not.toHaveBeenCalled();
  });

  it('senza inbox.gestisci: il gate blocca PRIMA di leggere qualunque assegnazione', async () => {
    getSessionContextMock.mockResolvedValue(ctxConPermessi(['inbox.view']));

    await acceptPratica(PID);

    expect(prismaMock.praticaAssegnazione.findFirst).not.toHaveBeenCalled();
  });

  it('con inbox.gestisci: supera il gate (arriva al controllo di assegnazione)', async () => {
    prismaMock.praticaAssegnazione.findFirst.mockResolvedValue(null);

    const res = await acceptPratica(PID);

    expect(res).toEqual({
      ok: false,
      error: 'Pratica non disponibile: già accettata da un altra agenzia o non assegnata a te.',
    });
  });

  it('proprietario: ammesso anche senza permessi espliciti (isOwner bypassa il gate)', async () => {
    getSessionContextMock.mockResolvedValue(ctxConPermessi([], { isOwner: true }));
    prismaMock.praticaAssegnazione.findFirst.mockResolvedValue(null);

    const res = await acceptPratica(PID);

    // Superato il gate: fallisce sull'assegnazione, non sui permessi.
    expect(res).toEqual({
      ok: false,
      error: 'Pratica non disponibile: già accettata da un altra agenzia o non assegnata a te.',
    });
  });

  it('acceptAndRedirect propaga il diniego del gate (wrapper coperto, nessuna scrittura)', async () => {
    getSessionContextMock.mockResolvedValue(ctxConPermessi(['inbox.view']));

    await expect(acceptAndRedirect(PID)).rejects.toThrow(/__REDIRECT__/);

    const url = redirectMock.mock.calls.at(-1)?.[0] as string;
    expect(decodeURIComponent(url)).toContain('Non hai i permessi per questa azione');
    expect(prismaMock.praticaAssegnazione.update).not.toHaveBeenCalled();
  });
});

/**
 * Guard visura scaduta (clausola 8 dei Termini), aggiunto accanto a
 * `isAgenziaBloccata` in `acceptPratica`. A differenza degli altri due punti
 * (che fanno `redirect`), qui la forma è un `return { ok: false, error }`:
 * replica quella dello stesso blocco isAgenziaBloccata sopra.
 *
 * Il messaggio NON deve contenere "sospeso"/"sospesa": è una limitazione
 * operativa (clausola 12.1), non una sospensione dell'account.
 */
describe('acceptPratica — guard visura scaduta (clausola 8)', () => {
  it('agenzia con visura scaduta → non accetta la pratica, nessuna scrittura', async () => {
    visuraScadutaMock.mockResolvedValue(true);

    const res = await acceptPratica(PID);

    expect(res.ok).toBe(false);
    expect((res as { error: string }).error).toContain('/visura');
    expect((res as { error: string }).error.toLowerCase()).not.toContain('sospes');
    expect(prismaMock.praticaAssegnazione.findFirst).not.toHaveBeenCalled();
    expect(prismaMock.praticaAssegnazione.update).not.toHaveBeenCalled();
  });

  it('agenzia con visura valida → procede (arriva al controllo di assegnazione)', async () => {
    visuraScadutaMock.mockResolvedValue(false);
    prismaMock.praticaAssegnazione.findFirst.mockResolvedValue(null);

    const res = await acceptPratica(PID);

    expect(res).toEqual({
      ok: false,
      error: 'Pratica non disponibile: già accettata da un altra agenzia o non assegnata a te.',
    });
  });
});

describe('rejectPratica — capability', () => {
  it('un operatore senza inbox.gestisci non rifiuta', async () => {
    getSessionContextMock.mockResolvedValue(ctxConPermessi(['inbox.view']));

    const res = await rejectPratica(PID, new FormData());

    expect(res).toEqual({ ok: false, error: 'Non hai i permessi per questa azione' });
    expect(prismaMock.praticaAssegnazione.update).not.toHaveBeenCalled();
  });

  it('senza inbox.gestisci: il gate blocca PRIMA di leggere qualunque assegnazione', async () => {
    getSessionContextMock.mockResolvedValue(ctxConPermessi(['inbox.view']));

    await rejectPratica(PID, new FormData());

    expect(prismaMock.praticaAssegnazione.findFirst).not.toHaveBeenCalled();
  });

  it('con inbox.gestisci: supera il gate (arriva al controllo di assegnazione)', async () => {
    prismaMock.praticaAssegnazione.findFirst.mockResolvedValue(null);

    const res = await rejectPratica(PID, new FormData());

    expect(res).toEqual({ ok: false, error: 'Assegnazione non trovata o già chiusa' });
  });

  it('rejectAndRedirect propaga il diniego del gate (wrapper coperto, nessuna scrittura)', async () => {
    getSessionContextMock.mockResolvedValue(ctxConPermessi(['inbox.view']));

    await expect(rejectAndRedirect(PID, new FormData())).rejects.toThrow(/__REDIRECT__/);

    const url = redirectMock.mock.calls.at(-1)?.[0] as string;
    expect(decodeURIComponent(url)).toContain('Non hai i permessi per questa azione');
    expect(prismaMock.praticaAssegnazione.update).not.toHaveBeenCalled();
  });
});
