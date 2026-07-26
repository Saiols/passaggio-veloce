import { describe, it, expect, vi, beforeEach } from 'vitest';

const { authMock, tickMock, redirectMock, revalidateMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  tickMock: vi.fn(),
  redirectMock: vi.fn(),
  revalidateMock: vi.fn(),
}));

vi.mock('@/auth', () => ({ auth: authMock }));
vi.mock('@/lib/distribuzione', () => ({ tickAllPraticheInDistribuzione: tickMock }));
vi.mock('next/cache', () => ({ revalidatePath: revalidateMock }));
vi.mock('next/navigation', () => ({ redirect: redirectMock }));

import { runDistribuzioneTickAction } from './actions';

/**
 * Il `redirect` di Next INTERROMPE l'esecuzione lanciando: un mock che ritorna
 * normalmente farebbe proseguire la funzione oltre la guardia di ruolo e
 * renderebbe verde un test di autorizzazione rotto. Qui il mock lancia come in
 * produzione e il chiamante assorbe il sentinel.
 */
const SENTINEL = 'NEXT_REDIRECT';

async function eseguiAssorbendoIlRedirect(): Promise<void> {
  try {
    await runDistribuzioneTickAction();
  } catch (e) {
    if ((e as Error)?.message !== SENTINEL) throw e;
  }
}

/** Query string dell'ultimo redirect, già parsata. */
function paramsUltimoRedirect(): URLSearchParams {
  const url = String(redirectMock.mock.calls.at(-1)?.[0] ?? '');
  return new URLSearchParams(url.slice(url.indexOf('?') + 1));
}

beforeEach(() => {
  vi.clearAllMocks();
  redirectMock.mockImplementation(() => {
    throw new Error(SENTINEL);
  });
  authMock.mockResolvedValue({ user: { id: 'adm', role: 'ADMIN_PIATTAFORMA' } });
  tickMock.mockResolvedValue({ scanned: 7, expanded: 2, riprese: 3, zonaNonCoperta: 1, errors: 0 });
});

describe('runDistribuzioneTickAction: banner del tick manuale', () => {
  // M-2: i parametri erano enumerati a mano e `riprese` era stato dimenticato.
  // È l'unica osservabilità manuale della ripresa: senza, l'admin che lancia il
  // tick vede "Anelli espansi: 0 · Zona non coperta: 0" e conclude che non è
  // successo niente, mentre 3 pratiche sono appena ripartite.
  it('propaga TUTTI i contatori del tick, riprese incluso', async () => {
    await eseguiAssorbendoIlRedirect();

    const params = paramsUltimoRedirect();
    expect(params.get('tick')).toBe('1');
    expect(params.get('scanned')).toBe('7');
    expect(params.get('expanded')).toBe('2');
    expect(params.get('riprese')).toBe('3');
    expect(params.get('zonaNonCoperta')).toBe('1');
  });

  it('lo zero viaggia esplicito, non come parametro assente', async () => {
    tickMock.mockResolvedValue({ scanned: 0, expanded: 0, riprese: 0, zonaNonCoperta: 0, errors: 0 });

    await eseguiAssorbendoIlRedirect();

    expect(paramsUltimoRedirect().get('riprese')).toBe('0');
  });

  it('non-admin: redirect alla dashboard senza eseguire il tick', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN_AZIENDA' } });

    await eseguiAssorbendoIlRedirect();

    expect(tickMock).not.toHaveBeenCalled();
    expect(redirectMock).toHaveBeenCalledWith('/dashboard');
  });
});
