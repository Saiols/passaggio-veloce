import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { prisma } from '@pv/db';
import { buildDocumentoPdf } from '@/lib/fatturazione/pdf';
import {
  documentoPdfInclude,
  documentoPdfInput,
  documentoPdfFilename,
} from '@/lib/fatturazione/documento-pdf';
import { attachmentContentDisposition } from '@/lib/http/content-disposition';
import { canViewDocumentoFiscale } from '@/lib/fatturazione/access';
import { getSessionContext } from '@/lib/auth/session-context';
import { toSedeScope } from '@/lib/sedi/scope-filters';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/fatturazione/[id]/pdf — scarica il PDF del documento fiscale.
 * Access control identico al dettaglio: admin, oppure la company dell'utente
 * è emittente o destinatario del documento.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const { id } = await params;

  const doc = await prisma.documentoFiscale.findUnique({
    where: { id },
    include: documentoPdfInclude,
  });
  if (!doc) {
    return NextResponse.json({ error: 'not-found' }, { status: 404 });
  }

  const isAdmin = session.user.role === 'ADMIN_PIATTAFORMA';
  const ctx = await getSessionContext();
  const allowed = canViewDocumentoFiscale(
    {
      emittenteCompanyId: doc.emittenteCompanyId,
      destinatarioCompanyId: doc.destinatarioCompanyId,
      praticaAgenziaSedeId: doc.pratica?.agenziaSedeId ?? null,
      praticaBrokerSedeId: doc.pratica?.brokerSedeId ?? null,
      payoutWalletSedeId: doc.payout?.wallet?.sedeId ?? null,
    },
    {
      companyId: session.user.companyId,
      isAdminPiattaforma: isAdmin,
      scope: ctx ? toSedeScope(ctx) : { scopeIds: [], aggregate: false },
    },
  );
  if (!allowed) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const pdfBytes = await buildDocumentoPdf(documentoPdfInput(doc));
  const filename = documentoPdfFilename(doc);

  return new Response(pdfBytes as BlobPart, {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': attachmentContentDisposition(filename),
      'Cache-Control': 'private, no-store',
    },
  });
}
