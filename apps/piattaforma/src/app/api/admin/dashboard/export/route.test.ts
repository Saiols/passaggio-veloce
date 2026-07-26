import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * La route deve passare per il risolutore condiviso `lib/finanze/periodo`, non
 * per una sua copia: la copia locale era già divergente (nessun ramo per
 * `giorno`, catturato dall'`else` di `anno`) e dal tab 24h il CSV scaricava un
 * anno intero. Qui si verifica il comportamento, non l'import.
 */

const { authMock, prismaMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  prismaMock: { pratica: { findMany: vi.fn() } },
}));

vi.mock('@pv/db', () => ({ prisma: prismaMock, Prisma: {} }));
vi.mock('@/auth', () => ({ auth: authMock }));

import { GET } from './route';

const URL_BASE = 'http://localhost/api/admin/dashboard/export';

function whereDellaChiamata() {
  return prismaMock.pratica.findMany.mock.calls[0]![0].where as {
    createdAt?: { gte?: Date; lte?: Date };
    tipo?: string;
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN_PIATTAFORMA' } });
  prismaMock.pratica.findMany.mockResolvedValue([]);
});

describe('GET /api/admin/dashboard/export — permessi', () => {
  it('senza sessione: 401 e nessuna query', async () => {
    authMock.mockResolvedValue(null);
    const res = await GET(new Request(`${URL_BASE}?periodo=mese`));
    expect(res.status).toBe(401);
    expect(prismaMock.pratica.findMany).not.toHaveBeenCalled();
  });
  it('ruolo non admin piattaforma: 403 e nessuna query', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN_AZIENDA' } });
    const res = await GET(new Request(`${URL_BASE}?periodo=mese`));
    expect(res.status).toBe(403);
    expect(prismaMock.pratica.findMany).not.toHaveBeenCalled();
  });
});

describe('GET /api/admin/dashboard/export — periodo', () => {
  it('periodo=giorno esporta 24 ore, non un anno (regressione)', async () => {
    await GET(new Request(`${URL_BASE}?periodo=giorno`));
    const gte = whereDellaChiamata().createdAt!.gte!;
    const oreIndietro = (Date.now() - gte.getTime()) / 3_600_000;
    expect(oreIndietro).toBeGreaterThan(23.5);
    expect(oreIndietro).toBeLessThan(24.5);
  });

  it('periodo=custom filtra fra i due giorni interi, in Europe/Rome', async () => {
    await GET(new Request(`${URL_BASE}?periodo=custom&da=2026-06-01&a=2026-06-30`));
    const createdAt = whereDellaChiamata().createdAt!;
    expect(createdAt.gte!.toISOString()).toBe('2026-05-31T22:00:00.000Z');
    expect(createdAt.lte!.toISOString()).toBe('2026-06-30T21:59:59.999Z');
  });

  it('periodo sconosciuto ricade su mese, non sull ultimo ramo', async () => {
    await GET(new Request(`${URL_BASE}?periodo=pippo`));
    const gte = whereDellaChiamata().createdAt!.gte!;
    const giorniIndietro = (Date.now() - gte.getTime()) / 86_400_000;
    expect(giorniIndietro).toBeGreaterThan(27);
    expect(giorniIndietro).toBeLessThan(32);
  });

  it('il filtro tipo resta indipendente dal periodo', async () => {
    await GET(new Request(`${URL_BASE}?periodo=custom&da=2026-06-01&tipo=MINIVOLTURA`));
    expect(whereDellaChiamata().tipo).toBe('MINIVOLTURA');
  });

  it('il nome del file riporta il range, non la parola custom', async () => {
    const res = await GET(new Request(`${URL_BASE}?periodo=custom&da=2026-06-01&a=2026-06-30`));
    expect(res.headers.get('Content-Disposition')).toContain('pratiche-2026-06-01_2026-06-30');
  });
});
