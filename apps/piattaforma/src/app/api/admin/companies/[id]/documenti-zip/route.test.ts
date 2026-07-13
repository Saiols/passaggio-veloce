import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Copre `GET /api/admin/companies/[id]/documenti-zip`:
 * - guard `isAdminPiattaforma` (ASSISTENTE negato, come sul download singolo
 *   in api/documenti/[id]/route.ts);
 * - selezione documenti aziendali (companyId valorizzato, praticaId null);
 * - inclusione del mandato di fatturazione firmato nello zip;
 * - un file mancante nello storage non fa fallire lo zip (si salta e basta).
 */

const { authMock, prismaMock, storageGetBufferMock, buildZipMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  prismaMock: {
    company: { findUnique: vi.fn() },
  },
  storageGetBufferMock: vi.fn(),
  buildZipMock: vi.fn(async (_entries: readonly { name: string; buffer: Buffer }[]) => Buffer.from('zip')),
}));

vi.mock('@pv/db', () => ({ prisma: prismaMock }));
vi.mock('@/auth', () => ({ auth: authMock }));
vi.mock('@/lib/providers/storage', () => ({ storageGetBuffer: storageGetBufferMock }));
vi.mock('@/lib/documenti/zip', () => ({ buildDocumentiZip: buildZipMock }));

import { GET } from './route';

function sessione(role: string) {
  return { user: { id: 'u1', role, companyId: undefined } };
}

function params(id = 'c1') {
  return { params: Promise.resolve({ id }) };
}

const azienda = {
  ragioneSociale: 'Rossi Srl',
  deletedAt: null,
  documenti: [
    { tipo: 'CI_FRONTE', owner: 'AMMINISTRATORE', originalFilename: 'ci.jpg', storageKey: 'k-ci' },
    { tipo: 'VISURA_CAMERALE', owner: null, originalFilename: 'visura.pdf', storageKey: 'k-visura' },
  ],
  mandatoFatturazione: null as { storageKey: string; firmatoAt: Date } | null,
};

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.company.findUnique.mockResolvedValue(azienda);
  storageGetBufferMock.mockResolvedValue(Buffer.from('data'));
  buildZipMock.mockResolvedValue(Buffer.from('zip'));
});

describe('GET /api/admin/companies/[id]/documenti-zip — guard isAdminPiattaforma', () => {
  it('senza sessione → 401, nessuna query', async () => {
    authMock.mockResolvedValue(null);

    const res = await GET(new Request('http://x'), params());

    expect(res.status).toBe(401);
    expect(prismaMock.company.findUnique).not.toHaveBeenCalled();
  });

  it('ASSISTENTE → 403, nessuna query (negato come sul download singolo)', async () => {
    authMock.mockResolvedValue(sessione('ASSISTENTE'));

    const res = await GET(new Request('http://x'), params());

    expect(res.status).toBe(403);
    expect(prismaMock.company.findUnique).not.toHaveBeenCalled();
  });

  it('ADMIN_AZIENDA (utenza cliente) → 403', async () => {
    authMock.mockResolvedValue(sessione('ADMIN_AZIENDA'));

    const res = await GET(new Request('http://x'), params());

    expect(res.status).toBe(403);
  });

  it('ADMIN_PIATTAFORMA → 200, zip costruito con i documenti aziendali', async () => {
    authMock.mockResolvedValue(sessione('ADMIN_PIATTAFORMA'));

    const res = await GET(new Request('http://x'), params());

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/zip');
    expect(res.headers.get('Content-Disposition')).toContain('Rossi%20Srl');
    expect(buildZipMock).toHaveBeenCalledTimes(1);
    const entries = buildZipMock.mock.calls[0][0];
    expect(entries).toHaveLength(2);
    expect(entries[0].name).toContain('Rossi Srl');
    expect(entries[0].name).toContain('CI fronte');
  });
});

describe('GET /api/admin/companies/[id]/documenti-zip — azienda non trovata / cancellata', () => {
  it('azienda inesistente → 404', async () => {
    authMock.mockResolvedValue(sessione('ADMIN_PIATTAFORMA'));
    prismaMock.company.findUnique.mockResolvedValue(null);

    const res = await GET(new Request('http://x'), params());

    expect(res.status).toBe(404);
  });

  it('azienda soft-deleted (deletedAt valorizzato) → 404', async () => {
    authMock.mockResolvedValue(sessione('ADMIN_PIATTAFORMA'));
    prismaMock.company.findUnique.mockResolvedValue({ ...azienda, deletedAt: new Date() });

    const res = await GET(new Request('http://x'), params());

    expect(res.status).toBe(404);
  });
});

describe('GET /api/admin/companies/[id]/documenti-zip — file mancanti nello storage', () => {
  it('un file mancante viene saltato, lo zip contiene solo gli altri', async () => {
    authMock.mockResolvedValue(sessione('ADMIN_PIATTAFORMA'));
    storageGetBufferMock
      .mockResolvedValueOnce(Buffer.from('ci'))
      .mockRejectedValueOnce(new Error('blob not found'));

    const res = await GET(new Request('http://x'), params());

    expect(res.status).toBe(200);
    const entries = buildZipMock.mock.calls[0][0];
    expect(entries).toHaveLength(1);
    expect(entries[0].name).toContain('CI fronte');
  });

  it('tutti i file mancanti (nessun mandato) → 404 no_documents, zip mai costruito', async () => {
    authMock.mockResolvedValue(sessione('ADMIN_PIATTAFORMA'));
    storageGetBufferMock.mockRejectedValue(new Error('blob not found'));

    const res = await GET(new Request('http://x'), params());

    expect(res.status).toBe(404);
    expect(buildZipMock).not.toHaveBeenCalled();
  });
});

describe('GET /api/admin/companies/[id]/documenti-zip — mandato di fatturazione', () => {
  it('mandato firmato (storageKey valorizzato) → incluso nello zip', async () => {
    authMock.mockResolvedValue(sessione('ADMIN_PIATTAFORMA'));
    prismaMock.company.findUnique.mockResolvedValue({
      ...azienda,
      documenti: [],
      mandatoFatturazione: { storageKey: 'k-mandato', firmatoAt: new Date('2026-01-01') },
    });

    const res = await GET(new Request('http://x'), params());

    expect(res.status).toBe(200);
    const entries = buildZipMock.mock.calls[0][0];
    expect(entries).toHaveLength(1);
    expect(entries[0].name).toBe('Rossi Srl - Mandato fatturazione.pdf');
  });

  it('nessun mandato (relazione assente) e nessun documento → 404 no_documents', async () => {
    authMock.mockResolvedValue(sessione('ADMIN_PIATTAFORMA'));
    prismaMock.company.findUnique.mockResolvedValue({
      ...azienda,
      documenti: [],
      mandatoFatturazione: null,
    });

    const res = await GET(new Request('http://x'), params());

    expect(res.status).toBe(404);
    expect(buildZipMock).not.toHaveBeenCalled();
  });
});
