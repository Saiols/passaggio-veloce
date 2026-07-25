import { Readable } from 'node:stream';
import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Copre il gate `pratiche.download` sulle route di download pratiche
 * (singola pdf/zip e il bundle `documenti-zip`): il permesso NON sostituisce
 * `canAccessPratica`/lo scope sede (quello decide QUALI pratiche sono
 * visibili), decide SE l'utente può scaricarle. Lo storage e la generazione
 * PDF/ZIP sono mockati: qui si verifica solo l'autorizzazione.
 */

const { authMock, getSessionContextMock, prismaMock, storageGetMock, buildPdfMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  getSessionContextMock: vi.fn(),
  prismaMock: {
    pratica: { findUnique: vi.fn(), findMany: vi.fn() },
  },
  storageGetMock: vi.fn(),
  buildPdfMock: vi.fn(async () => Buffer.from('pdf')),
}));

vi.mock('@pv/db', () => ({ prisma: prismaMock }));
vi.mock('@/auth', () => ({ auth: authMock }));
vi.mock('@/lib/auth/session-context', () => ({ getSessionContext: getSessionContextMock }));
vi.mock('@/lib/providers/storage', () => ({
  getStorage: () => ({ get: storageGetMock }),
  StorageNotFoundError: class StorageNotFoundError extends Error {},
}));
vi.mock('@/lib/documenti/pdf', () => ({ buildPraticaPdf: buildPdfMock }));

import { GET as pdfGET } from './[id]/pdf/route';
import { GET as zipGET } from './[id]/zip/route';
import { GET as documentiZipGET } from './documenti-zip/route';

function sessione(role: string, companyType: string, companyId = 'ag1') {
  return { user: { id: 'u1', role, companyType, companyId } };
}

/**
 * Contesto `getSessionContext()`: NON-owner con la sede 's1' in scope, che
 * combacia con `agenziaSedeId` della pratica fixture — isola il gate di
 * permesso come unica variabile (vedi stesso ragionamento nel test analogo
 * di api/fatturazione/route.authz.test.ts).
 */
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
    sospensione: { sospeso: false, motivo: null, origine: null },
  };
}

const pratica = {
  id: 'p1',
  codicePratica: 'PV-1',
  brokerId: 'br1',
  agenziaAssegnataId: 'ag1',
  brokerSedeId: null,
  agenziaSedeId: 's1',
  veicoli: [{ targa: 'AB123CD' }],
  documenti: [
    { id: 'd1', tipo: 'LIBRETTO_CIRCOLAZIONE', owner: 'VENDITORE', storageKey: 'k1', originalFilename: 'x.pdf', mimeType: 'application/pdf', veicolo: { targa: 'AB123CD' } },
  ],
};

function params(id = 'p1') {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.pratica.findUnique.mockResolvedValue(pratica);
  prismaMock.pratica.findMany.mockResolvedValue([pratica]);
  storageGetMock.mockResolvedValue({
    stream: Readable.from([Buffer.from('data')]),
    sizeBytes: 4,
    mimeType: 'application/pdf',
  });
});

describe('GET /api/pratiche/[id]/pdf — gate pratiche.download', () => {
  it("l'agenzia assegnataria SENZA pratiche.download → 403, nessun file letto", async () => {
    authMock.mockResolvedValue(sessione('UTENTE_AZIENDA', 'AGENZIA'));
    getSessionContextMock.mockResolvedValue(ctx({ permessi: [] }));

    const res = await pdfGET(new Request('http://x'), params());

    expect(res.status).toBe(403);
    expect(storageGetMock).not.toHaveBeenCalled();
  });

  it("l'agenzia assegnataria CON pratiche.download → 200", async () => {
    authMock.mockResolvedValue(sessione('UTENTE_AZIENDA', 'AGENZIA'));
    getSessionContextMock.mockResolvedValue(ctx({ permessi: ['pratiche.view', 'pratiche.download'] }));

    const res = await pdfGET(new Request('http://x'), params());

    expect(res.status).toBe(200);
    expect(storageGetMock).toHaveBeenCalledTimes(1);
  });

  it('ADMIN_PIATTAFORMA scarica sempre (bypass esplicito)', async () => {
    authMock.mockResolvedValue(sessione('ADMIN_PIATTAFORMA', undefined as unknown as string, undefined as unknown as string));
    getSessionContextMock.mockResolvedValue(null);

    const res = await pdfGET(new Request('http://x'), params());

    expect(res.status).toBe(200);
  });
});

describe('GET /api/pratiche/[id]/zip — gate pratiche.download', () => {
  it('SENZA pratiche.download → 403', async () => {
    authMock.mockResolvedValue(sessione('UTENTE_AZIENDA', 'AGENZIA'));
    getSessionContextMock.mockResolvedValue(ctx({ permessi: [] }));

    const res = await zipGET(new Request('http://x'), params());

    expect(res.status).toBe(403);
    expect(storageGetMock).not.toHaveBeenCalled();
  });

  it('CON pratiche.download → 200', async () => {
    authMock.mockResolvedValue(sessione('UTENTE_AZIENDA', 'AGENZIA'));
    getSessionContextMock.mockResolvedValue(ctx({ permessi: ['pratiche.view', 'pratiche.download'] }));

    const res = await zipGET(new Request('http://x'), params());

    expect(res.status).toBe(200);
  });
});

describe('GET /api/pratiche/documenti-zip — gate pratiche.download', () => {
  it('SENZA pratiche.download → 403, nessuna query pratiche', async () => {
    authMock.mockResolvedValue(sessione('UTENTE_AZIENDA', 'AGENZIA'));
    getSessionContextMock.mockResolvedValue(ctx({ permessi: [] }));

    const res = await documentiZipGET();

    expect(res.status).toBe(403);
    expect(prismaMock.pratica.findMany).not.toHaveBeenCalled();
  });

  it('CON pratiche.download → 200', async () => {
    authMock.mockResolvedValue(sessione('UTENTE_AZIENDA', 'AGENZIA'));
    getSessionContextMock.mockResolvedValue(ctx({ permessi: ['pratiche.view', 'pratiche.download'] }));

    const res = await documentiZipGET();

    expect(res.status).toBe(200);
    expect(prismaMock.pratica.findMany).toHaveBeenCalledTimes(1);
  });
});
