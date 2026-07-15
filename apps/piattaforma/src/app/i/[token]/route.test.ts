import { describe, it, expect, vi, beforeEach } from 'vitest';

const findFirst = vi.fn();
const update = vi.fn();
vi.mock('@pv/db', () => ({
  prisma: {
    crmContact: {
      findFirst: (...a: unknown[]) => findFirst(...a),
      update: (...a: unknown[]) => update(...a),
    },
  },
}));

import { GET } from './route';

function req(url = 'https://app.test/i/tok') {
  return new Request(url) as unknown as import('next/server').NextRequest;
}

describe('GET /i/[token]', () => {
  beforeEach(() => {
    findFirst.mockReset();
    update.mockReset();
  });

  it('token valido broker con codice attivo → redirect /register/dealer?promo=CODE', async () => {
    findFirst.mockResolvedValue({
      id: 'c1', cat: 'BROKER', status: 'S4',
      promoCodeInviato: { code: 'BENVENUTO50', active: true, expiresAt: null },
    });
    update.mockResolvedValue({});
    const res = await GET(req(), { params: Promise.resolve({ token: 'tok' }) });
    expect(res.status).toBe(302);
    const loc = res.headers.get('location')!;
    expect(loc).toContain('/register/dealer');
    expect(loc).toContain('promo=BENVENUTO50');
  });

  it('token valido agenzia senza codice → /register/agenzia senza promo', async () => {
    findFirst.mockResolvedValue({ id: 'c2', cat: 'AGENZIA', status: 'S4', promoCodeInviato: null });
    update.mockResolvedValue({});
    const res = await GET(req(), { params: Promise.resolve({ token: 'tok' }) });
    const loc = res.headers.get('location')!;
    expect(loc).toContain('/register/agenzia');
    expect(loc).not.toContain('promo=');
  });

  it('token inesistente → /register neutro, nessuna update', async () => {
    findFirst.mockResolvedValue(null);
    const res = await GET(req(), { params: Promise.resolve({ token: 'nope' }) });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toContain('/register');
    expect(update).not.toHaveBeenCalled();
  });

  it('codice scaduto → redirect senza promo', async () => {
    findFirst.mockResolvedValue({
      id: 'c3', cat: 'BROKER', status: 'S4',
      promoCodeInviato: { code: 'OLD', active: true, expiresAt: new Date(Date.now() - 1000) },
    });
    update.mockResolvedValue({});
    const res = await GET(req(), { params: Promise.resolve({ token: 'tok' }) });
    expect(res.headers.get('location')).not.toContain('promo=');
  });

  it('codice disattivato → redirect senza promo', async () => {
    findFirst.mockResolvedValue({
      id: 'c4', cat: 'AGENZIA', status: 'S4',
      promoCodeInviato: { code: 'OFF', active: false, expiresAt: null },
    });
    update.mockResolvedValue({});
    const res = await GET(req(), { params: Promise.resolve({ token: 'tok' }) });
    expect(res.headers.get('location')).not.toContain('promo=');
  });

  it('apertura valida: update marca linkAperto, S5 e incrementa linkAperture', async () => {
    findFirst.mockResolvedValue({ id: 'c5', cat: 'BROKER', status: 'S4', promoCodeInviato: null });
    update.mockResolvedValue({});
    await GET(req(), { params: Promise.resolve({ token: 'tok' }) });
    const data = update.mock.calls[0][0].data;
    expect(data.linkAperto).toBe(true);
    expect(data.status).toBe('S5');
    expect(data.linkAperture).toEqual({ increment: 1 });
  });
});
