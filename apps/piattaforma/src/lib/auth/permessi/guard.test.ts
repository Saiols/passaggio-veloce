import { describe, it, expect, vi, beforeEach } from 'vitest';

const { getSessionContextMock, redirectMock } = vi.hoisted(() => ({
  getSessionContextMock: vi.fn(),
  redirectMock: vi.fn(() => {
    throw new Error('NEXT_REDIRECT');
  }),
}));

vi.mock('@/lib/auth/session-context', () => ({ getSessionContext: getSessionContextMock }));
vi.mock('next/navigation', () => ({ redirect: redirectMock }));

import { hasPermesso, requirePermesso, assertPermesso, toPermessiCtx } from './guard';
import { ERRORE_SOSPENSIONE } from '@/lib/auth/sospensione';
// Type-only: `@/lib/auth/session-context` è mockato sopra, ma un `import type`
// viene cancellato in compilazione e non passa dal mock.
import type { SessionContext } from '@/lib/auth/session-context';
import type { Permesso } from './catalogo';

beforeEach(() => vi.clearAllMocks());

/**
 * Fixture TIPIZZATA di `SessionContext`. Prima era un oggetto parziale passato a
 * `toPermessiCtx()` con `as never`, e quel cast annullava proprio la garanzia
 * che rendere `soloLettura` obbligatorio aveva comprato: il compilatore non
 * enumerava più i contesti incompleti in questo test. Con la factory, un campo
 * nuovo su `SessionContext` fa fallire QUI la compilazione — che è il punto.
 */
function ctx(over: Partial<SessionContext> = {}): SessionContext {
  return {
    user: { id: 'u1', role: 'UTENTE_AZIENDA' },
    companyId: 'c1',
    isOwner: false,
    accessibleSedi: [],
    currentSede: null,
    scopeIds: [],
    membershipRuoli: {},
    companyType: 'AGENZIA',
    permessi: new Set<Permesso>(['wallet.view']),
    sospensione: { sospeso: false, motivo: null, origine: null },
    ...over,
  };
}

describe('hasPermesso', () => {
  it('vero se il permesso è nel set', async () => {
    getSessionContextMock.mockResolvedValue(ctx());
    expect(await hasPermesso('wallet.view')).toBe(true);
  });

  it('falso se manca', async () => {
    getSessionContextMock.mockResolvedValue(ctx());
    expect(await hasPermesso('wallet.payout')).toBe(false);
  });

  it("vero sempre per l'owner", async () => {
    getSessionContextMock.mockResolvedValue(ctx({ isOwner: true, permessi: new Set<Permesso>() }));
    expect(await hasPermesso('wallet.payout')).toBe(true);
  });

  it('falso se non autenticato', async () => {
    getSessionContextMock.mockResolvedValue(null);
    expect(await hasPermesso('wallet.view')).toBe(false);
  });
});

describe('requirePermesso', () => {
  it('ok quando il permesso c’è', async () => {
    getSessionContextMock.mockResolvedValue(ctx());
    expect(await requirePermesso('wallet.view')).toEqual({ ok: true });
  });

  it('errore quando manca, senza lanciare', async () => {
    getSessionContextMock.mockResolvedValue(ctx());
    const res = await requirePermesso('wallet.payout');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe('Non hai i permessi per questa azione');
  });

  it('errore quando non autenticato', async () => {
    getSessionContextMock.mockResolvedValue(null);
    const res = await requirePermesso('wallet.view');
    expect(res.ok).toBe(false);
  });
});

/**
 * IMPORTANT #2/#3 (review round 1): senza questi test le tre giunzioni che il
 * Task 3 introduce — `sospensione` popolata, `ctx.sospensione.sospeso →
 * soloLettura` in `toPermessiCtx()`, messaggio dedicato — non avevano nessuna
 * copertura di regressione al di fuori del mock a mano di `check.test.ts`.
 */
describe('requirePermesso — sospensione', () => {
  const ctxSospeso = () =>
    ctx({
      permessi: new Set<Permesso>(['wallet.view', 'wallet.payout']),
      sospensione: { sospeso: true, motivo: 'Uso improprio della piattaforma.', origine: 'UTENTE' },
    });

  it('sospeso: una chiave di scrittura viene negata col messaggio dedicato, non quello generico', async () => {
    getSessionContextMock.mockResolvedValue(ctxSospeso());
    const res = await requirePermesso('wallet.payout');
    expect(res).toEqual({ ok: false, error: ERRORE_SOSPENSIONE });
  });

  it('sospeso: una chiave di lettura resta concessa', async () => {
    getSessionContextMock.mockResolvedValue(ctxSospeso());
    const res = await requirePermesso('wallet.view');
    expect(res).toEqual({ ok: true });
  });
});

describe('toPermessiCtx — mappatura ctx.sospensione.sospeso → soloLettura', () => {
  it('sospensione.sospeso true → soloLettura true', () => {
    const pctx = toPermessiCtx(ctx({ sospensione: { sospeso: true, motivo: 'x', origine: 'UTENTE' } }));
    expect(pctx.soloLettura).toBe(true);
  });

  it('sospensione.sospeso false → soloLettura false', () => {
    const pctx = toPermessiCtx(ctx());
    expect(pctx.soloLettura).toBe(false);
  });
});

describe('assertPermesso', () => {
  it('non redirige quando il permesso c’è', async () => {
    getSessionContextMock.mockResolvedValue(ctx());
    await assertPermesso('wallet.view');
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it('redirige a /dashboard quando manca', async () => {
    getSessionContextMock.mockResolvedValue(ctx());
    await expect(assertPermesso('wallet.payout')).rejects.toThrow('NEXT_REDIRECT');
    expect(redirectMock).toHaveBeenCalledWith('/dashboard');
  });
});
