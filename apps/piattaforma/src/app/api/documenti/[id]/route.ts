import { Readable } from 'node:stream';
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { prisma } from '@pv/db';
import { getStorage, StorageNotFoundError } from '@/lib/providers/storage';

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
      originalFilename: true,
      pratica: { select: { brokerId: true, agenziaAssegnataId: true } },
    },
  });

  if (!doc) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const isAdmin = session.user.role === 'ADMIN_PIATTAFORMA';
  const userCompanyId = session.user.companyId;

  const allowed =
    isAdmin ||
    (doc.companyId && doc.companyId === userCompanyId) ||
    (doc.pratica?.brokerId && doc.pratica.brokerId === userCompanyId) ||
    (doc.pratica?.agenziaAssegnataId &&
      doc.pratica.agenziaAssegnataId === userCompanyId);

  if (!allowed) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  try {
    const file = await getStorage().get(doc.storageKey);
    const headers = new Headers();
    headers.set('Content-Type', doc.mimeType);
    headers.set(
      'Content-Disposition',
      `attachment; filename="${encodeURIComponent(doc.originalFilename)}"`,
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
