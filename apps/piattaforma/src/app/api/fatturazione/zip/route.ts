import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { prisma, type Prisma, type DocumentoFiscaleTipo } from '@pv/db';
import { isAdminPiattaforma } from '@/lib/auth/permissions';
import { buildDocumentoPdf } from '@/lib/fatturazione/pdf';
import { documentoPdfInclude, documentoPdfInput } from '@/lib/fatturazione/documento-pdf';
import { labelTipoDocumento } from '@/lib/fatturazione/format';
import { buildPraticaZip, type ZipEntry } from '@/lib/documenti/zip';
import { attachmentContentDisposition } from '@/lib/http/content-disposition';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// I PDF sono generati al volo (pdf-lib): può richiedere qualche secondo.
export const maxDuration = 60;

const TIPI: DocumentoFiscaleTipo[] = ['FATTURA_PV', 'DOC_BROKER', 'NOTA_VARIAZIONE', 'PENALE_BROKER'];
/** Tetto difensivo per non sforare il timeout della funzione (volume basso). */
const MAX_DOCS = 500;

function safe(s: string): string {
  return s.replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
}

/**
 * GET /api/fatturazione/zip — scarica in un unico ZIP i PDF delle fatture
 * visibili all'utente, con lo STESSO scope/filtri delle rispettive liste:
 *  - ADMIN_PIATTAFORMA → tutti i documenti (filtri q + tipo);
 *  - DEALER (broker)   → documenti emessi (emittenteCompanyId);
 *  - AGENZIA           → documenti ricevuti (destinatarioCompanyId).
 * I PDF sono nominati in base alla pratica: "<codicePratica>_<n°documento>.pdf".
 */
export async function GET(req: Request): Promise<Response> {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const url = new URL(req.url);
  const qTrim = (url.searchParams.get('q') ?? '').trim();
  const numQ = /^\d+$/.test(qTrim) ? Number(qTrim) : null;
  const tipoParam = url.searchParams.get('tipo') ?? '';
  const tipoFilter = TIPI.includes(tipoParam as DocumentoFiscaleTipo)
    ? (tipoParam as DocumentoFiscaleTipo)
    : null;

  const companyId = session.user.companyId;
  const companyType = session.user.companyType;

  const where: Prisma.DocumentoFiscaleWhereInput = {};
  if (isAdminPiattaforma(session.user.role)) {
    if (tipoFilter) where.tipo = tipoFilter;
  } else if (companyType === 'DEALER' && companyId) {
    where.emittenteCompanyId = companyId;
  } else if (companyType === 'AGENZIA' && companyId) {
    where.destinatarioCompanyId = companyId;
  } else {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  if (qTrim) {
    where.OR = [
      { pratica: { codicePratica: { contains: qTrim, mode: 'insensitive' } } },
      ...(numQ !== null ? [{ numeroProgressivo: numQ }] : []),
    ];
  }

  const docs = await prisma.documentoFiscale.findMany({
    where,
    orderBy: { emessoAt: 'desc' },
    take: MAX_DOCS,
    include: documentoPdfInclude,
  });
  if (docs.length === 0) {
    return NextResponse.json({ error: 'no_documents' }, { status: 404 });
  }

  // Nome file in base alla pratica: <codicePratica>_<n°documento>.pdf. Dedup
  // (su scope admin numeri di soggetti diversi potrebbero coincidere come prosa).
  const seen = new Map<string, number>();
  const entries: ZipEntry[] = [];
  for (const doc of docs) {
    const pdfBytes = await buildDocumentoPdf(documentoPdfInput(doc));
    const codice = doc.pratica?.codicePratica ? `${safe(doc.pratica.codicePratica)}_` : '';
    const numero = safe(
      doc.numeroDocumentoStr ??
        `${labelTipoDocumento(doc.tipo)}-${doc.numeroProgressivo}-${doc.anno}`,
    );
    const baseName = `${codice}${numero}.pdf`;
    const dup = seen.get(baseName) ?? 0;
    seen.set(baseName, dup + 1);
    const name = dup === 0 ? baseName : `${codice}${numero}_${dup + 1}.pdf`;
    entries.push({ name, buffer: Buffer.from(pdfBytes) });
  }

  const zipBuffer = await buildPraticaZip(entries);
  const archive = `fatture_${new Date().toISOString().slice(0, 10)}.zip`;
  return new Response(new Uint8Array(zipBuffer), {
    status: 200,
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': attachmentContentDisposition(archive),
      'Content-Length': String(zipBuffer.length),
      'Cache-Control': 'private, no-store',
    },
  });
}
