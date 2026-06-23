import { describe, it, expect, vi, beforeEach } from 'vitest';

const { getCtxMock, cookieSetMock, cookiesMock } = vi.hoisted(() => ({
  getCtxMock: vi.fn(),
  cookieSetMock: vi.fn(),
  cookiesMock: vi.fn(),
}));

vi.mock('@/lib/auth/session-context', () => ({
  getSessionContext: getCtxMock,
  SEDE_COOKIE: 'pv_sede',
}));
vi.mock('next/headers', () => ({ cookies: cookiesMock }));

import { setCurrentSedeAction } from './actions';

const sedeB = { id: 'b', nome: 'Sede B', type: 'AGENZIA' as const };

beforeEach(() => {
  vi.clearAllMocks();
  cookiesMock.mockResolvedValue({ set: cookieSetMock });
});

describe('setCurrentSedeAction', () => {
  it('non autenticato: ok=false, niente cookie', async () => {
    getCtxMock.mockResolvedValue(null);
    const r = await setCurrentSedeAction('b');
    expect(r.ok).toBe(false);
    expect(cookieSetMock).not.toHaveBeenCalled();
  });

  it('proprietario seleziona ALL: setta cookie', async () => {
    getCtxMock.mockResolvedValue({ isOwner: true, accessibleSedi: [sedeB] });
    const r = await setCurrentSedeAction('ALL');
    expect(r.ok).toBe(true);
    expect(cookieSetMock).toHaveBeenCalledWith('pv_sede', 'ALL', expect.objectContaining({ path: '/' }));
  });

  it('operatore seleziona sede non accessibile: ok=false, niente cookie', async () => {
    getCtxMock.mockResolvedValue({ isOwner: false, accessibleSedi: [sedeB] });
    const r = await setCurrentSedeAction('zzz');
    expect(r.ok).toBe(false);
    expect(cookieSetMock).not.toHaveBeenCalled();
  });

  it('operatore seleziona sede accessibile: setta cookie', async () => {
    getCtxMock.mockResolvedValue({ isOwner: false, accessibleSedi: [sedeB] });
    const r = await setCurrentSedeAction('b');
    expect(r.ok).toBe(true);
    expect(cookieSetMock).toHaveBeenCalledWith('pv_sede', 'b', expect.objectContaining({ path: '/' }));
  });
});
