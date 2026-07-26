import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { prisma, type Prisma } from '@pv/db';
import { isAdminPiattaforma, isAdminOrAssistente } from '@/lib/auth/permissions';
import { hasPermesso } from '@/lib/auth/permessi/guard';
import { buildDocumentoPdf } from '@/lib/fatturazione/pdf';
import { documentoPdfInclude, documentoPdfInput } from '@/lib/fatturazione/documento-pdf';
import { labelTipoDocumento } from '@/lib/fatturazione/format';
import { parseFatturaFiltriFromUrl, fatturaWhereFiltri } from '@/lib/fatturazione/filtri';
import { buildDocumentiZip, type ZipEntry } from '@/lib/documenti/zip';
import { attachmentContentDisposition } from '@/lib/http/content-disposition';
import { romeIsoDate } from '@/lib/date/rome-day';
import { getSessionContext } from '@/lib/auth/session-context';
import { toSedeScope, whereDocumentoFiscale, NO_SEDE_SCOPE } from '@/lib/sedi/scope-filters';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// I PDF sono generati al volo (pdf-lib): può richiedere qualche secondo.
export const maxDuration = 60;

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
 * Lo scope company è poi ristretto per sede da `whereDocumentoFiscale`: fuori
 * dalla vista aggregata passano solo i documenti agganciati a una sede in scope
 * (pratica o wallet del payout), più — per il solo proprietario — i documenti
 * senza alcuna sede, che sono dell'entità legale.
 * I PDF sono nominati in base alla pratica: "<codicePratica>_<n°documento>.pdf".
 */
export async function GET(req: Request): Promise<Response> {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  // Il permesso non sostituisce lo scope sotto (che decide QUALI documenti
  // sono visibili): decide SE l'utente può scaricarli. Bypass esplicito per
  // lo staff di piattaforma (companyId null → nessun permesso azienda).
  if (!isAdminOrAssistente(session.user.role) && !(await hasPermesso('fatture.download'))) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const url = new URL(req.url);
  // Legge TUTTE le chiavi note (compresa `emissione`) dall'URL, invece di
  // elencarle a mano: vedi il commento su `parseFatturaFiltriFromUrl` — un
  // filtro dimenticato qui veniva scartato in silenzio (C-1).
  const filtri = parseFatturaFiltriFromUrl(url);

  const companyId = session.user.companyId;
  const companyType = session.user.companyType;

  // Scope per ruolo, identico alle liste (incluso lo scoping sede); i filtri
  // (q/tipo/date/sede) sono ANDati — MAI spread: `{ ...scope, ...filtri }`
  // sovrascriverebbe silenziosamente la chiave `AND` dello scope con quella
  // dei filtri utente (leak sede).
  let scope: Prisma.DocumentoFiscaleWhereInput;
  if (isAdminPiattaforma(session.user.role)) {
    scope = {};
  } else if (companyType === 'DEALER' && companyId) {
    const ctx = await getSessionContext();
    scope = whereDocumentoFiscale(ctx ? toSedeScope(ctx) : NO_SEDE_SCOPE, {
      companyId,
      ruolo: 'DEALER',
    });
  } else if (companyType === 'AGENZIA' && companyId) {
    const ctx = await getSessionContext();
    scope = whereDocumentoFiscale(ctx ? toSedeScope(ctx) : NO_SEDE_SCOPE, {
      companyId,
      ruolo: 'AGENZIA',
    });
  } else {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  const where: Prisma.DocumentoFiscaleWhereInput = { AND: [scope, fatturaWhereFiltri(filtri)] };

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

  const zipBuffer = await buildDocumentiZip(entries);
  const archive = `fatture_${romeIsoDate(new Date())}.zip`;
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
