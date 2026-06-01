import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { prisma } from '@pv/db';
import { getStorage, StorageNotFoundError } from '@/lib/providers/storage';
import { buildPraticaZip, streamToBuffer, zipEntryName, type ZipEntry } from '@/lib/documenti/zip';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const pratica = await prisma.pratica.findUnique({
    where: { id },
    select: {
      id: true,
      codicePratica: true,
      brokerId: true,
      agenziaAssegnataId: true,
      documenti: {
        where: { deletedAt: null },
        select: {
          id: true,
          tipo: true,
          owner: true,
          storageKey: true,
          originalFilename: true,
        },
      },
    },
  });

  if (!pratica) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const isAdmin = session.user.role === 'ADMIN_PIATTAFORMA';
  const userCompanyId = session.user.companyId;
  const allowed =
    isAdmin ||
    (pratica.brokerId && pratica.brokerId === userCompanyId) ||
    (pratica.agenziaAssegnataId && pratica.agenziaAssegnataId === userCompanyId);

  if (!allowed) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  if (pratica.documenti.length === 0) {
    return NextResponse.json({ error: 'no_documents' }, { status: 404 });
  }

  const storage = getStorage();
  const entries: ZipEntry[] = [];
  for (let i = 0; i < pratica.documenti.length; i++) {
    const doc = pratica.documenti[i];
    try {
      const file = await storage.get(doc.storageKey);
      const buffer = await streamToBuffer(file.stream);
      entries.push({ name: zipEntryName(doc, i), buffer });
    } catch (err) {
      if (err instanceof StorageNotFoundError) continue;
      throw err;
    }
  }

  if (entries.length === 0) {
    return NextResponse.json({ error: 'no_files' }, { status: 404 });
  }

  const zipBuffer = await buildPraticaZip(entries);
  const filename = `${pratica.codicePratica ?? pratica.id}.zip`;
  const headers = new Headers();
  headers.set('Content-Type', 'application/zip');
  headers.set('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
  headers.set('Content-Length', String(zipBuffer.length));
  headers.set('Cache-Control', 'private, no-store');
  return new Response(new Uint8Array(zipBuffer), { headers });
}
