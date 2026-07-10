import { Readable } from 'node:stream';
import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Copre il gate `pratiche.download` su `GET /api/documenti/[id]`: il permesso
 * NON sostituisce `canAccessDocumento` (scope), decide SE l'utente può
 * scaricare. Storage mockato: qui si verifica solo l'autorizzazione.
 */

const { authMock, getSessionContextMock, prismaMock, storageGetMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  getSessionContextMock: vi.fn(),
  prismaMock: {
    documento: { findUnique: vi.fn() },
  },
  storageGetMock: vi.fn(),
}));

vi.mock('@pv/db', () => ({ prisma: prismaMock }));
vi.mock('@/auth', () => ({ auth: authMock }));
vi.mock('@/lib/auth/session-context', () => ({ getSessionContext: getSessionContextMock }));
vi.mock('@/lib/providers/storage', () => ({
  getStorage: () => ({ get: storageGetMock }),
  StorageNotFoundError: class StorageNotFoundError extends Error {},
}));

import { GET } from './[id]/route';

function sessione(role: string, companyType: string, companyId = 'ag1') {
  return { user: { id: 'u1', role, companyType, companyId } };
}

/** Vedi analoga funzione in api/pratiche/route.authz.test.ts: non-owner con
 * la sede 's1' in scope, che combacia con la pratica del documento fixture. */
function ctx(opts: { permessi?: string[] }) {
  return {
    user: { id: 'u1', role: 'UTENTE_AZIENDA' },
    companyId: 'ag1',
    companyType: 'AGENZIA' as const,
    isOwner: false,
    accessibleSedi: [],
    currentSede: { kind: 'ONE' as const, sede: { id: 's1' } },
    scopeIds: ['s1'],
    membershipRuoli: {},
    permessi: new Set(opts.permessi ?? []),
  };
}

const documento = {
  id: 'd1',
  praticaId: 'p1',
  companyId: null,
  storageKey: 'k1',
  mimeType: 'application/pdf',
  tipo: 'LIBRETTO_CIRCOLAZIONE',
  owner: 'VENDITORE',
  originalFilename: 'x.pdf',
  pratica: {
    brokerId: 'br1',
    agenziaAssegnataId: 'ag1',
    brokerSedeId: null,
    agenziaSedeId: 's1',
    codicePratica: 'PV-1',
  },
};

function params(id = 'd1') {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.documento.findUnique.mockResolvedValue(documento);
  storageGetMock.mockResolvedValue({
    stream: Readable.from([Buffer.from('data')]),
    sizeBytes: 4,
    mimeType: 'application/pdf',
  });
});

describe('GET /api/documenti/[id] — gate pratiche.download', () => {
  it("l'agenzia assegnataria SENZA pratiche.download → 403, nessun file letto", async () => {
    authMock.mockResolvedValue(sessione('UTENTE_AZIENDA', 'AGENZIA'));
    getSessionContextMock.mockResolvedValue(ctx({ permessi: [] }));

    const res = await GET(new Request('http://x'), params());

    expect(res.status).toBe(403);
    expect(storageGetMock).not.toHaveBeenCalled();
  });

  it("l'agenzia assegnataria CON pratiche.download → 200", async () => {
    authMock.mockResolvedValue(sessione('UTENTE_AZIENDA', 'AGENZIA'));
    getSessionContextMock.mockResolvedValue(ctx({ permessi: ['pratiche.view', 'pratiche.download'] }));

    const res = await GET(new Request('http://x'), params());

    expect(res.status).toBe(200);
    expect(storageGetMock).toHaveBeenCalledTimes(1);
  });

  it('ADMIN_PIATTAFORMA scarica sempre (bypass esplicito)', async () => {
    authMock.mockResolvedValue(sessione('ADMIN_PIATTAFORMA', undefined as unknown as string, undefined as unknown as string));
    getSessionContextMock.mockResolvedValue(null);

    const res = await GET(new Request('http://x'), params());

    expect(res.status).toBe(200);
  });
});
