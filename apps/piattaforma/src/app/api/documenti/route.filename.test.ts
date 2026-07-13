import { Readable } from 'node:stream';
import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Copre il nome del file scaricato da `GET /api/documenti/[id]`.
 *
 * Difetto corretto: per i documenti AZIENDALI (praticaId null, companyId
 * valorizzato — CI/codice fiscale/visura del legale rappresentante) la route
 * non aveva il codicePratica (non esiste, niente pratica) e cadeva sul
 * fallback letterale "documento" in `documentoDownloadName`. Risultato: admin
 * che scarica i documenti di aziende diverse ottiene file OMONIMI
 * ("documento - CI fronte.jpg") che si sovrascrivono in Downloads.
 *
 * Fix: per questi documenti si usa la ragione sociale dell'azienda al posto
 * del codice pratica. Per i documenti di pratica il nome resta invariato
 * (`doc.pratica.codicePratica` ha sempre la precedenza) — vedi il secondo
 * test, che blinda la non-regressione.
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

function params(id = 'd1') {
  return { params: Promise.resolve({ id }) };
}

/** ADMIN_PIATTAFORMA: bypassa sia `canAccessDocumento` che il gate permessi
 * (vedi route.authz.test.ts) — qui interessa solo il nome del file, non l'authz. */
function adminSession() {
  return {
    user: {
      id: 'admin1',
      role: 'ADMIN_PIATTAFORMA',
      companyType: undefined,
      companyId: undefined,
    },
  };
}

function filenameFrom(res: Response): string {
  const header = res.headers.get('Content-Disposition') ?? '';
  const match = header.match(/filename="([^"]*)"/);
  return decodeURIComponent(match?.[1] ?? '');
}

beforeEach(() => {
  vi.clearAllMocks();
  authMock.mockResolvedValue(adminSession());
  getSessionContextMock.mockResolvedValue(null);
  storageGetMock.mockResolvedValue({
    stream: Readable.from([Buffer.from('data')]),
    sizeBytes: 4,
    mimeType: 'image/jpeg',
  });
});

describe('GET /api/documenti/[id] — nome file scaricato', () => {
  it('documento AZIENDALE (praticaId null, companyId valorizzato) → usa la ragione sociale, non "documento"', async () => {
    prismaMock.documento.findUnique.mockResolvedValue({
      id: 'd1',
      praticaId: null,
      companyId: 'c1',
      storageKey: 'k1',
      mimeType: 'image/jpeg',
      tipo: 'CI_FRONTE',
      owner: null,
      originalFilename: 'scan.jpg',
      pratica: null,
      company: { ragioneSociale: 'Rossi Auto SRL' },
    });

    const res = await GET(new Request('http://x'), params('d1'));

    expect(res.status).toBe(200);
    const filename = filenameFrom(res);
    expect(filename).toBe('Rossi Auto SRL - CI fronte.jpg');
    expect(filename).not.toContain('documento -');
  });

  it('documento DI PRATICA → usa il codicePratica (non regredisce sulla ragione sociale)', async () => {
    prismaMock.documento.findUnique.mockResolvedValue({
      id: 'd2',
      praticaId: 'p1',
      companyId: null,
      storageKey: 'k2',
      mimeType: 'application/pdf',
      tipo: 'LIBRETTO_CIRCOLAZIONE',
      owner: 'VENDITORE',
      originalFilename: 'libretto.pdf',
      pratica: {
        brokerId: 'br1',
        agenziaAssegnataId: 'ag1',
        brokerSedeId: null,
        agenziaSedeId: null,
        codicePratica: 'PV-2026-00042',
      },
      // Anche se per errore fosse presente una company, il codicePratica deve
      // vincere sempre quando c'è una pratica.
      company: { ragioneSociale: 'Non deve comparire SRL' },
    });

    const res = await GET(new Request('http://x'), params('d2'));

    expect(res.status).toBe(200);
    const filename = filenameFrom(res);
    expect(filename).toBe('PV-2026-00042 - Libretto circolazione - venditore.pdf');
    expect(filename).not.toContain('Non deve comparire');
  });
});
