import { Readable } from 'node:stream';
import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Copre il gate `pratiche.download` su `GET /api/documenti/[id]`: il permesso
 * NON sostituisce `canAccessDocumento` (scope), decide SE l'utente può
 * scaricare. Storage mockato: qui si verifica solo l'autorizzazione.
 */

const { authMock, getSessionContextMock, prismaMock, storageGetMock, registraLogMock } = vi.hoisted(
  () => ({
    authMock: vi.fn(),
    getSessionContextMock: vi.fn(),
    prismaMock: {
      documento: { findUnique: vi.fn() },
    },
    storageGetMock: vi.fn(),
    registraLogMock: vi.fn(),
  }),
);

vi.mock('@pv/db', () => ({ prisma: prismaMock }));
vi.mock('@/auth', () => ({ auth: authMock }));
vi.mock('@/lib/auth/session-context', () => ({ getSessionContext: getSessionContextMock }));
vi.mock('@/lib/providers/storage', () => ({
  getStorage: () => ({ get: storageGetMock }),
  StorageNotFoundError: class StorageNotFoundError extends Error {},
}));
vi.mock('@/lib/audit/log-accessi', () => ({ registraLogAsync: registraLogMock }));

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
    sospensione: { sospeso: false, motivo: null, origine: null },
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

/**
 * Log accessi (art. 32 GDPR). Questa route è la ragione principale per cui il
 * log esiste: è l'unico punto in cui qualcuno apre i documenti d'identità di
 * venditori e acquirenti, e l'unico modo di rispondere a «chi ha visto i miei
 * documenti».
 *
 * Il ramo consentito è stato verificato anche sul database reale (una
 * riga `DOCUMENTO_ACCESSO` con l'azienda bersaglio corretta). I due rami
 * NEGATI si esercitano qui, perché nel browser richiederebbero di costruire
 * una seconda utenza priva di permessi — e sono proprio quelli che contano:
 * un tentativo respinto dice che qualcuno ha provato.
 */
describe('GET /api/documenti/[id] — log accessi', () => {
  it('403 per scope/proprietà → registra un tentativo NEGATO', async () => {
    authMock.mockResolvedValue(sessione('UTENTE_AZIENDA', 'AGENZIA', 'azienda-estranea'));
    getSessionContextMock.mockResolvedValue({
      ...ctx({ permessi: ['pratiche.download'] }),
      companyId: 'azienda-estranea',
      scopeIds: ['sede-estranea'],
      currentSede: { kind: 'ONE' as const, sede: { id: 'sede-estranea' } },
    });

    const res = await GET(new Request('http://x'), params());

    expect(res.status).toBe(403);
    expect(registraLogMock).toHaveBeenCalledWith(
      expect.objectContaining({
        azione: 'DOCUMENTO_ACCESSO',
        negato: true,
        risorsaTipo: 'documento',
        risorsaId: 'd1',
      }),
    );
  });

  it('403 per permesso mancante → registra un tentativo NEGATO, con la ragione', async () => {
    authMock.mockResolvedValue(sessione('UTENTE_AZIENDA', 'AGENZIA'));
    getSessionContextMock.mockResolvedValue(ctx({ permessi: [] }));

    const res = await GET(new Request('http://x'), params());

    expect(res.status).toBe(403);
    expect(registraLogMock).toHaveBeenCalledWith(
      expect.objectContaining({ negato: true, dettaglio: expect.stringContaining('pratiche.download') }),
    );
  });

  it('accesso consentito → registrato come NON negato, prima di leggere il file', async () => {
    authMock.mockResolvedValue(sessione('UTENTE_AZIENDA', 'AGENZIA'));
    getSessionContextMock.mockResolvedValue(ctx({ permessi: ['pratiche.download'] }));

    await GET(new Request('http://x'), params());

    expect(registraLogMock).toHaveBeenCalledWith(
      expect.objectContaining({ azione: 'DOCUMENTO_ACCESSO', negato: false, risorsaId: 'd1' }),
    );
    // Il log precede la lettura dallo storage: la risposta è uno stream, e
    // loggare in coda significherebbe non registrare nulla se il processo
    // muore a metà download — cioè proprio nel caso anomalo.
    expect(registraLogMock.mock.invocationCallOrder[0]).toBeLessThan(
      storageGetMock.mock.invocationCallOrder[0],
    );
  });

  it("un file mancante nello storage non cancella la traccia dell'accesso", async () => {
    // Verificato anche in locale: il documento fixture non esiste nel blob
    // store di sviluppo, la route ha risposto 404 e la riga di log c'era.
    authMock.mockResolvedValue(sessione('ADMIN_PIATTAFORMA', undefined as unknown as string, undefined as unknown as string));
    getSessionContextMock.mockResolvedValue(null);
    const { StorageNotFoundError } = await import('@/lib/providers/storage');
    storageGetMock.mockRejectedValue(new StorageNotFoundError('assente'));

    const res = await GET(new Request('http://x'), params());

    expect(res.status).toBe(404);
    expect(registraLogMock).toHaveBeenCalledWith(expect.objectContaining({ negato: false }));
  });
});

describe('GET /api/documenti/[id] — invariante I-3: ASSISTENTE mai sui documenti aziendali', () => {
  // Documento AZIENDALE (companyId valorizzato, nessuna pratica): visura
  // camerale / CI del legale rappresentante, caricati in registrazione.
  const documentoAziendale = {
    id: 'd2',
    praticaId: null,
    companyId: 'c9',
    storageKey: 'k9',
    mimeType: 'image/jpeg',
    tipo: 'CI_FRONTE',
    owner: 'AMMINISTRATORE',
    originalFilename: 'ci.jpg',
    pratica: null,
    company: { ragioneSociale: 'Bianchi Srl' },
  };

  // La riga `const isAdmin = session.user.role === 'ADMIN_PIATTAFORMA'`
  // (route.ts) è l'UNICA cosa che nega questo documento all'ASSISTENTE: se un
  // domani venisse "uniformata" a `isAdminOrAssistente(session.user.role)` (le
  // due righe sembrano un'incoerenza da sistemare, sono a 21 righe di distanza
  // nello stesso file), `canAccessDocumento` riceverebbe `isAdminPiattaforma:
  // true` per l'ASSISTENTE e tornerebbe true al suo primo `if`, bypassando
  // anche il match su `companyId` — aprendo la carta d'identità del legale
  // rappresentante di QUALUNQUE azienda della piattaforma. Questo test è
  // pensato per intercettare esattamente quella regressione (vedi il commento
  // gemello sulla riga 55 di route.ts).
  it('ASSISTENTE + documento aziendale (CI del legale rappresentante) → 403, nessun file letto', async () => {
    authMock.mockResolvedValue({
      user: { id: 'u2', role: 'ASSISTENTE', companyType: undefined, companyId: undefined },
    });
    getSessionContextMock.mockResolvedValue(null);
    prismaMock.documento.findUnique.mockResolvedValue(documentoAziendale);

    const res = await GET(new Request('http://x'), params('d2'));

    expect(res.status).toBe(403);
    expect(storageGetMock).not.toHaveBeenCalled();
  });
});
