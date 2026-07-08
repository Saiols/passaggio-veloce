import { Readable } from 'node:stream';
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { prisma } from '@pv/db';
import { getStorage, StorageNotFoundError } from '@/lib/providers/storage';
import { documentoDownloadName } from '@/lib/documenti/labels';
import { getSessionContext } from '@/lib/auth/session-context';
import { toSedeScope, NO_SEDE_SCOPE } from '@/lib/sedi/scope-filters';

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

  // Multi-sede: la company non basta — un ADMIN_SEDE non scarica i documenti
  // di un'altra filiale. L'owner aggregato mantiene l'accesso a tutto il gruppo.
  const inSede = (sedeId: string | null): boolean =>
    scope.aggregate || (sedeId != null && scope.scopeIds.includes(sedeId));

  const allowed =
    isAdmin ||
    // documento caricato dalla company stessa (non legato a pratica)
    (doc.companyId != null && doc.companyId === userCompanyId && !doc.praticaId) ||
    (doc.pratica != null &&
      doc.pratica.brokerId === userCompanyId &&
      inSede(doc.pratica.brokerSedeId)) ||
    (doc.pratica != null &&
      doc.pratica.agenziaAssegnataId === userCompanyId &&
      inSede(doc.pratica.agenziaSedeId));

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
