import { Readable } from 'node:stream';
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { prisma } from '@pv/db';
import { getStorage, StorageNotFoundError } from '@/lib/providers/storage';
import { documentoDownloadName } from '@/lib/documenti/labels';
import { getSessionContext } from '@/lib/auth/session-context';
import { toSedeScope, NO_SEDE_SCOPE } from '@/lib/sedi/scope-filters';
import { canAccessPratica } from '@/lib/pratiche/access';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const doc = await prisma.documento.findUnique({
    where: { id },
    select: {
      id: true,
      praticaId: true,
      companyId: true,
      storageKey: true,
      mimeType: true,
      tipo: true,
      owner: true,
      originalFilename: true,
      pratica: {
        select: {
          brokerId: true,
          agenziaAssegnataId: true,
          brokerSedeId: true,
          agenziaSedeId: true,
          codicePratica: true,
        },
      },
    },
  });

  if (!doc) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const isAdmin = session.user.role === 'ADMIN_PIATTAFORMA';
  const userCompanyId = session.user.companyId;
  const ctx = await getSessionContext();
  const scope = ctx ? toSedeScope(ctx) : NO_SEDE_SCOPE;

  // Documento aziendale (nessuna pratica): visura camerale e documento
  // d'identità del legale rappresentante caricati in registrazione. Appartiene
  // alla madre, non a una filiale: lo vede il SOLO proprietario, in qualunque
  // vista — stesso principio di `canViewDocumentoFiscale` per i documenti senza
  // sede. Senza il gate `isOwner`, un OPERATORE di un'altra sede che indovina
  // l'UUID scaricherebbe la carta d'identità dell'amministratore.
  const documentoAziendale =
    doc.companyId != null && doc.companyId === userCompanyId && !doc.praticaId;

  const allowed =
    isAdmin ||
    (documentoAziendale && scope.isOwner) ||
    (doc.pratica != null &&
      canAccessPratica(doc.pratica, {
        companyId: userCompanyId,
        isAdminPiattaforma: isAdmin,
        scope,
      }));

  if (!allowed) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  try {
    const file = await getStorage().get(doc.storageKey);
    // Nome file = "<numero pratica> - <label documento>": non esponiamo mai il
    // nome file originale caricato dall'utente.
    const filename = documentoDownloadName(doc, {
      codicePratica: doc.pratica?.codicePratica ?? null,
    });
    const headers = new Headers();
    headers.set('Content-Type', doc.mimeType);
    headers.set(
      'Content-Disposition',
      `attachment; filename="${encodeURIComponent(filename)}"`,
    );
    headers.set('Content-Length', String(file.sizeBytes));
    headers.set('Cache-Control', 'private, no-store');

    // Convert Node.js Readable to Web ReadableStream (Node 18+)
    const webStream = Readable.toWeb(file.stream) as ReadableStream;

    return new Response(webStream, { headers });
  } catch (err) {
    if (err instanceof StorageNotFoundError) {
      return NextResponse.json({ error: 'file_not_found' }, { status: 404 });
    }
    throw err;
  }
}
