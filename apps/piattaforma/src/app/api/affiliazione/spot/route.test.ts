import { describe, it, expect, vi, beforeEach } from 'vitest';

const { authMock, getSpotMock, dismissMock, hasPermessoMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  getSpotMock: vi.fn(),
  dismissMock: vi.fn(),
  hasPermessoMock: vi.fn(),
}));

vi.mock('@/auth', () => ({ auth: authMock }));
vi.mock('@/lib/auth/permessi/guard', () => ({ hasPermesso: hasPermessoMock }));
vi.mock('@/lib/affiliazione/spot', () => ({
  getAffiliazioneSpot: getSpotMock,
  dismissAffiliazioneSpot: dismissMock,
}));

import { GET, POST } from './route';
import { AFF_SPOT_COOKIE } from '@/lib/affiliazione/spot-cookie';

const PAYLOAD = {
  link: 'https://app.test/r/abc12345',
  sedeNomeFallback: null,
  sempliceCent: 1000,
  minivolturaCent: 500,
  minPayoutCent: 50_000,
  messaggioWhatsapp: 'Ciao! ... https://app.test/r/abc12345',
};

beforeEach(() => {
  vi.clearAllMocks();
  authMock.mockResolvedValue({ user: { id: 'u1' } });
  hasPermessoMock.mockResolvedValue(true);
});

describe('GET /api/affiliazione/spot', () => {
  it('ritorna il payload e segna la sessione come "già vista"', async () => {
    getSpotMock.mockResolvedValue(PAYLOAD);

    const res = (await GET()) as import('next/server').NextResponse;

    await expect(res.json()).resolves.toEqual({ show: true, ...PAYLOAD });
    expect(res.cookies.get(AFF_SPOT_COOKIE)?.value).toBe('1');
  });

  it('setta il cookie ANCHE quando non c\'è nulla da mostrare', async () => {
    // Senza questo, un utente che non deve vedere la modale (permesso mancante,
    // già dismessa) rifarebbe questa fetch a OGNI cambio pagina: la chrome
    // autenticata rimonta ad ogni navigazione.
    getSpotMock.mockResolvedValue(null);

    const res = (await GET()) as import('next/server').NextResponse;

    await expect(res.json()).resolves.toEqual({ show: false });
    expect(res.cookies.get(AFF_SPOT_COOKIE)?.value).toBe('1');
  });

  it('senza il permesso affiliazione.view non espone il link referral', async () => {
    hasPermessoMock.mockResolvedValue(false);

    const res = (await GET()) as import('next/server').NextResponse;

    await expect(res.json()).resolves.toEqual({ show: false });
    expect(getSpotMock).not.toHaveBeenCalled();
  });

  it('il cookie è di sessione (muore col browser) e leggibile dal client', async () => {
    getSpotMock.mockResolvedValue(null);

    const res = (await GET()) as import('next/server').NextResponse;
    const cookie = res.cookies.get(AFF_SPOT_COOKIE)!;

    expect(cookie.maxAge).toBeUndefined();
    expect(cookie.expires).toBeUndefined();
    expect(cookie.httpOnly).toBe(false);
  });
});

describe('POST /api/affiliazione/spot — "non mostrare più"', () => {
  it('persiste la presa visione per l\'utente loggato', async () => {
    const res = await POST();

    expect(dismissMock).toHaveBeenCalledWith('u1');
    expect(res.status).toBe(200);
  });

  it('rifiuta chi non è loggato senza scrivere nulla', async () => {
    authMock.mockResolvedValue(null);

    const res = await POST();

    expect(res.status).toBe(401);
    expect(dismissMock).not.toHaveBeenCalled();
  });
});
