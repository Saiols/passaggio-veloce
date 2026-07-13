import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Copre il gate `fatture.download` / `fatture.xml` sulle route di download
 * fatture: il permesso NON sostituisce `canViewDocumentoFiscale` (quello
 * decide QUALE documento è visibile — resta invariato qui), decide SE
 * l'utente può scaricarlo. Le dipendenze pesanti (generazione PDF/XML/ZIP)
 * sono mockate: questi test verificano solo l'autorizzazione, non il
 * contenuto del file prodotto (già coperto altrove).
 */

const { authMock, getSessionContextMock, prismaMock, buildPdfMock, buildZipMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  getSessionContextMock: vi.fn(),
  prismaMock: {
    documentoFiscale: { findUnique: vi.fn(), findMany: vi.fn() },
  },
  buildPdfMock: vi.fn(async () => new Uint8Array([1, 2, 3])),
  buildZipMock: vi.fn(async () => Buffer.from('zip')),
}));

vi.mock('@pv/db', () => ({ prisma: prismaMock }));
vi.mock('@/auth', () => ({ auth: authMock }));
vi.mock('@/lib/auth/session-context', () => ({ getSessionContext: getSessionContextMock }));

vi.mock('@/lib/fatturazione/pdf', () => ({ buildDocumentoPdf: buildPdfMock }));
vi.mock('@/lib/fatturazione/documento-pdf', () => ({
  documentoPdfInclude: {},
  documentoPdfInput: (doc: unknown) => doc,
  documentoPdfFilename: () => 'documento.pdf',
}));
vi.mock('@/lib/fatturazione/descrizione', () => ({
  descrizioneDocumento: () => ({ descrizione: 'x', riferimento: null }),
}));
vi.mock('@/lib/fatturazione/xml-mapper', () => ({
  toFatturaPaInput: () => ({ idTrasmittente: { idCodice: '00000000000' }, progressivoInvio: '1' }),
}));
vi.mock('@/lib/fatturazione/xml-fatturapa', () => ({ buildFatturaPaXml: () => '<xml/>' }));
vi.mock('@/lib/fatturazione/pv-emittente', () => ({ pvEmittente: () => ({}) }));
vi.mock('@/lib/documenti/zip', () => ({ buildDocumentiZip: buildZipMock }));

import { GET as pdfGET } from './[id]/pdf/route';
import { GET as xmlGET } from './[id]/xml/route';
import { GET as zipGET } from './zip/route';

function sessione(role: string, companyType: string, companyId = 'c1') {
  return { user: { id: 'u1', role, companyType, companyId } };
}

/**
 * Contesto `getSessionContext()`: NON-owner con la sede 's1' in scope, che
 * combacia con la sede del documento fiscale (fixture sotto) — così
 * `canViewDocumentoFiscale` concede l'accesso indipendentemente da `isOwner`,
 * isolando il gate di permesso come unica variabile del test (altrimenti
 * `isOwner: true` farebbe passare anche `hasPermesso` via bypass owner,
 * mascherando un gate di permesso rotto).
 */
function ctx(opts: { permessi?: string[] }) {
  return {
    user: { id: 'u1', role: 'UTENTE_AZIENDA' },
    companyId: 'c1',
    companyType: 'AGENZIA' as const,
    isOwner: false,
    accessibleSedi: [],
    currentSede: { kind: 'ONE' as const, sede: { id: 's1' } },
    scopeIds: ['s1'],
    membershipRuoli: {},
    permessi: new Set(opts.permessi ?? []),
  };
}

/** Documento fiscale visibile a `c1` (destinatario) tramite la sede 's1'
 * della pratica, in scope per il viewer non-owner sopra. */
const doc = {
  id: 'doc1',
  tipo: 'FATTURA_PV',
  fatturaPaTipo: 'TD01',
  numeroProgressivo: 1,
  anno: 2026,
  emessoAt: new Date('2026-01-01'),
  numeroDocumentoStr: 'PV-2026-00001',
  datiEmittente: {},
  datiDestinatario: {},
  imponibileCent: 1000,
  ivaCent: 220,
  aliquotaIvaPct: 22,
  importoLordoCent: 1220,
  emittenteCompanyId: null,
  destinatarioCompanyId: 'c1',
  pratica: { agenziaSedeId: 's1', brokerSedeId: null },
  payout: null,
  notaVariazionePer: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.documentoFiscale.findUnique.mockResolvedValue(doc);
  prismaMock.documentoFiscale.findMany.mockResolvedValue([doc]);
});

function params(id = 'doc1') {
  return { params: Promise.resolve({ id }) };
}

describe('GET /api/fatturazione/[id]/pdf — gate fatture.download', () => {
  it('agenzia proprietaria SENZA fatture.download → 403, nessun PDF generato', async () => {
    authMock.mockResolvedValue(sessione('UTENTE_AZIENDA', 'AGENZIA'));
    getSessionContextMock.mockResolvedValue(ctx({ permessi: [] }));

    const res = await pdfGET(new Request('http://x/api/fatturazione/doc1/pdf'), params());

    expect(res.status).toBe(403);
    expect(buildPdfMock).not.toHaveBeenCalled();
  });

  it('agenzia proprietaria CON fatture.download → 200', async () => {
    authMock.mockResolvedValue(sessione('UTENTE_AZIENDA', 'AGENZIA'));
    getSessionContextMock.mockResolvedValue(ctx({ permessi: ['fatture.view', 'fatture.download'] }));

    const res = await pdfGET(new Request('http://x/api/fatturazione/doc1/pdf'), params());

    expect(res.status).toBe(200);
    expect(buildPdfMock).toHaveBeenCalledTimes(1);
  });

  it('ADMIN_PIATTAFORMA scarica sempre (bypass esplicito, nessun permesso azienda)', async () => {
    authMock.mockResolvedValue(sessione('ADMIN_PIATTAFORMA', undefined as unknown as string, undefined));
    getSessionContextMock.mockResolvedValue(null);

    const res = await pdfGET(new Request('http://x/api/fatturazione/doc1/pdf'), params());

    expect(res.status).toBe(200);
  });
});

describe('GET /api/fatturazione/[id]/xml — gate fatture.xml', () => {
  it('agenzia proprietaria SENZA fatture.xml → 403', async () => {
    authMock.mockResolvedValue(sessione('UTENTE_AZIENDA', 'AGENZIA'));
    getSessionContextMock.mockResolvedValue(ctx({ permessi: ['fatture.download'] }));

    const res = await xmlGET(new Request('http://x/api/fatturazione/doc1/xml'), params());

    expect(res.status).toBe(403);
  });

  it('agenzia proprietaria CON fatture.xml → 200', async () => {
    authMock.mockResolvedValue(sessione('UTENTE_AZIENDA', 'AGENZIA'));
    getSessionContextMock.mockResolvedValue(ctx({ permessi: ['fatture.view', 'fatture.xml'] }));

    const res = await xmlGET(new Request('http://x/api/fatturazione/doc1/xml'), params());

    expect(res.status).toBe(200);
  });
});

describe('GET /api/fatturazione/zip — gate fatture.download', () => {
  it('agenzia SENZA fatture.download → 403, nessuna query fatture', async () => {
    authMock.mockResolvedValue(sessione('UTENTE_AZIENDA', 'AGENZIA'));
    getSessionContextMock.mockResolvedValue(ctx({ permessi: [] }));

    const res = await zipGET(new Request('http://x/api/fatturazione/zip'));

    expect(res.status).toBe(403);
    expect(prismaMock.documentoFiscale.findMany).not.toHaveBeenCalled();
  });

  it('agenzia CON fatture.download → 200', async () => {
    authMock.mockResolvedValue(sessione('UTENTE_AZIENDA', 'AGENZIA'));
    getSessionContextMock.mockResolvedValue(ctx({ permessi: ['fatture.view', 'fatture.download'] }));

    const res = await zipGET(new Request('http://x/api/fatturazione/zip'));

    expect(res.status).toBe(200);
    expect(buildZipMock).toHaveBeenCalledTimes(1);
  });
});
