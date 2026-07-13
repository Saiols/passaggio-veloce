import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Copre `GET /api/admin/fatturazione/export` (CSV): guard ADMIN_PIATTAFORMA e,
 * soprattutto, che `?emissione=` arrivi davvero al `where` (C-1). Prima del fix
 * la route costruiva l'input di `parseFatturaFiltri` elencando a mano
 * `q/tipo/dataDa/dataA/sede`: `emissione` non era nella lista e veniva scartato
 * in silenzio, quindi l'export ignorava il filtro "Da emettere"/"Emesse" e
 * scaricava sempre tutto (comprese fatture già emesse allo SdI e documenti
 * fuori campo IVA).
 */

const { authMock, prismaMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  prismaMock: {
    documentoFiscale: { findMany: vi.fn() },
  },
}));

vi.mock('@pv/db', () => ({ prisma: prismaMock }));
vi.mock('@/auth', () => ({ auth: authMock }));

import { GET } from './route';

function sessione(role: string) {
  return { user: { id: 'u1', role } };
}

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.documentoFiscale.findMany.mockResolvedValue([]);
});

describe('GET /api/admin/fatturazione/export — guard ADMIN_PIATTAFORMA', () => {
  it('senza sessione → 403, nessuna query', async () => {
    authMock.mockResolvedValue(null);

    const res = await GET(new Request('http://x/api/admin/fatturazione/export'));

    expect(res.status).toBe(403);
    expect(prismaMock.documentoFiscale.findMany).not.toHaveBeenCalled();
  });

  it('ASSISTENTE → 403 (export riservato al solo admin)', async () => {
    authMock.mockResolvedValue(sessione('ASSISTENTE'));

    const res = await GET(new Request('http://x/api/admin/fatturazione/export'));

    expect(res.status).toBe(403);
  });
});

describe('GET /api/admin/fatturazione/export — il filtro ?emissione= arriva al where (C-1)', () => {
  it('?emissione=DA_EMETTERE restringe il where ai soli documenti da emettere', async () => {
    authMock.mockResolvedValue(sessione('ADMIN_PIATTAFORMA'));

    await GET(new Request('http://x/api/admin/fatturazione/export?emissione=DA_EMETTERE'));

    expect(prismaMock.documentoFiscale.findMany).toHaveBeenCalledTimes(1);
    const { where } = prismaMock.documentoFiscale.findMany.mock.calls[0][0];
    expect(where).toEqual({
      AND: [{ fatturaPaTipo: { not: null }, trasmessoSdiAt: null }],
    });
  });

  it('?emissione=EMESSA restringe il where ai soli documenti già emessi', async () => {
    authMock.mockResolvedValue(sessione('ADMIN_PIATTAFORMA'));

    await GET(new Request('http://x/api/admin/fatturazione/export?emissione=EMESSA'));

    const { where } = prismaMock.documentoFiscale.findMany.mock.calls[0][0];
    expect(where).toEqual({ AND: [{ trasmessoSdiAt: { not: null } }] });
  });

  it('senza filtro emissione → where vuoto (nessuna restrizione), comportamento invariato', async () => {
    authMock.mockResolvedValue(sessione('ADMIN_PIATTAFORMA'));

    await GET(new Request('http://x/api/admin/fatturazione/export'));

    const { where } = prismaMock.documentoFiscale.findMany.mock.calls[0][0];
    expect(where).toEqual({});
  });

  it('si combina con gli altri filtri (tipo) nello stesso AND', async () => {
    authMock.mockResolvedValue(sessione('ADMIN_PIATTAFORMA'));

    await GET(
      new Request('http://x/api/admin/fatturazione/export?emissione=EMESSA&tipo=FATTURA_PV'),
    );

    const { where } = prismaMock.documentoFiscale.findMany.mock.calls[0][0];
    expect(where.AND).toHaveLength(2);
  });
});
