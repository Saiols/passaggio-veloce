import { describe, it, expect, vi, beforeEach } from 'vitest';

const { authMock, prismaMock, isAdminMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  prismaMock: { giustificativoInterno: { findMany: vi.fn() } },
  isAdminMock: vi.fn(),
}));

vi.mock('@/auth', () => ({ auth: authMock }));
vi.mock('@pv/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/auth/permissions', () => ({ isAdminPiattaforma: isAdminMock }));

import { GET } from './route';

beforeEach(() => {
  vi.clearAllMocks();
  authMock.mockResolvedValue({ user: { role: 'ADMIN_PIATTAFORMA' } });
  isAdminMock.mockReturnValue(true);
  prismaMock.giustificativoInterno.findMany.mockResolvedValue([
    {
      emessoAt: new Date('2026-07-10T10:00:00.000Z'),
      numeroStr: 'GI-2026-00001',
      importoCent: 20_000,
      datiBeneficiario: { ragioneSociale: 'Rossi Auto' },
      righe: [{ code: 'WELCOME' }],
    },
  ]);
});

describe('GET /api/admin/costi-promozionali/export', () => {
  it('403 per non-admin', async () => {
    isAdminMock.mockReturnValue(false);
    const res = await GET(new Request('http://x/api/admin/costi-promozionali/export'));
    expect(res.status).toBe(403);
  });

  it('CSV con header e riga per admin', async () => {
    const res = await GET(new Request('http://x/api/admin/costi-promozionali/export'));
    expect(res.headers.get('Content-Type')).toContain('text/csv');
    const body = await res.text();
    expect(body.split('\n')[0]).toBe('Data;Numero;Beneficiario;Importo;Codici promo');
    expect(body).toContain('2026-07-10;GI-2026-00001;Rossi Auto;200.00;WELCOME');
  });
});
