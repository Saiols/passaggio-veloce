import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { prisma } from '@pv/db';
import { getStorage, StorageNotFoundError } from '@/lib/providers/storage';
import { buildPraticaZip, streamToBuffer, zipEntryName, type ZipEntry } from '@/lib/documenti/zip';
import { appendToFilename } from '@/lib/documenti/filename';
import { getSessionContext } from '@/lib/auth/session-context';
import { toSedeScope, NO_SEDE_SCOPE } from '@/lib/sedi/scope-filters';
import { canAccessPratica } from '@/lib/pratiche/access';
import { hasPermesso } from '@/lib/auth/permessi/guard';
import { isAdminOrAssistente } from '@/lib/auth/permissions';

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
      brokerSedeId: true,
      agenziaSedeId: true,
      veicoli: { select: { targa: true } },
      documenti: {
        where: { deletedAt: null },
        select: {
          id: true,
          tipo: true,
          owner: true,
          storageKey: true,
          originalFilename: true,
          veicolo: { select: { targa: true } },
        },
      },
    },
  });

  if (!pratica) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const ctx = await getSessionContext();
  const scope = ctx ? toSedeScope(ctx) : NO_SEDE_SCOPE;

  const allowed = canAccessPratica(pratica, {
    companyId: session.user.companyId,
    isAdminPiattaforma: session.user.role === 'ADMIN_PIATTAFORMA',
    scope,
  });

  if (!allowed) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  // Il permesso non sostituisce `canAccessPratica` (scope): decide SE l'utente
  // può scaricare. Bypass esplicito per lo staff di piattaforma (companyId
  // null → nessun permesso azienda).
  if (!isAdminOrAssistente(session.user.role) && !(await hasPermesso('pratiche.download'))) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  if (pratica.documenti.length === 0) {
    return NextResponse.json({ error: 'no_documents' }, { status: 404 });
  }

  // Targa dell'unico veicolo della pratica (fallback per i doc non legati a un
  // veicolo specifico); null se la pratica ha più veicoli.
  const bundleTarga =
    pratica.veicoli.length === 1 ? (pratica.veicoli[0]?.targa ?? null) : null;

  const storage = getStorage();
  const entries: ZipEntry[] = [];
  for (let i = 0; i < pratica.documenti.length; i++) {
    const doc = pratica.documenti[i];
    try {
      const file = await storage.get(doc.storageKey);
      const buffer = await streamToBuffer(file.stream);
      entries.push({
        name: zipEntryName(doc, i, { codicePratica: pratica.codicePratica }),
        buffer,
      });
    } catch (err) {
      if (err instanceof StorageNotFoundError) continue;
      throw err;
    }
  }

  if (entries.length === 0) {
    return NextResponse.json({ error: 'no_files' }, { status: 404 });
  }

  const zipBuffer = await buildPraticaZip(entries);
  const filename = appendToFilename(
    `${pratica.codicePratica ?? pratica.id}.zip`,
    bundleTarga,
  );
  const headers = new Headers();
  headers.set('Content-Type', 'application/zip');
  headers.set('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
  headers.set('Content-Length', String(zipBuffer.length));
  headers.set('Cache-Control', 'private, no-store');
  return new Response(new Uint8Array(zipBuffer), { headers });
}
