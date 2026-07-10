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
import { canViewDocumentoFiscale, docSedeFields } from '@/lib/fatturazione/access';
import { getSessionContext } from '@/lib/auth/session-context';
import { toSedeScope, NO_SEDE_SCOPE } from '@/lib/sedi/scope-filters';
import { hasPermesso } from '@/lib/auth/permessi/guard';
import { isAdminOrAssistente } from '@/lib/auth/permissions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/fatturazione/[id]/pdf — scarica il PDF del documento fiscale.
 * Access control identico al dettaglio (`canViewDocumentoFiscale`): admin,
 * oppure la company dell'utente è emittente/destinatario E il documento è
 * agganciato a una sede in scope (pratica o wallet del payout). I documenti
 * senza alcuna sede sono dell'entità legale: solo il proprietario.
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
  const allowed = canViewDocumentoFiscale(docSedeFields(doc), {
    companyId: session.user.companyId,
    isAdminPiattaforma: isAdmin,
    scope: ctx ? toSedeScope(ctx) : NO_SEDE_SCOPE,
  });
  if (!allowed) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  // Il permesso non sostituisce `canViewDocumentoFiscale` (quello decide QUALE
  // documento è visibile): decide SE l'utente può scaricarlo. Lo staff di
  // piattaforma non ha permessi azienda (companyId null → set vuoto): bypass
  // esplicito, nessuna ereditarietà silenziosa.
  if (!isAdminOrAssistente(session.user.role) && !(await hasPermesso('fatture.download'))) {
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
