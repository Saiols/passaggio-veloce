import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { prisma } from '@pv/db';
import { getStorage, StorageNotFoundError } from '@/lib/providers/storage';
import { streamToBuffer } from '@/lib/documenti/zip';
import { appendToFilename } from '@/lib/documenti/filename';
import { buildPraticaPdf, type PdfEntry } from '@/lib/documenti/pdf';
import { getSessionContext } from '@/lib/auth/session-context';
import { toSedeScope, NO_SEDE_SCOPE } from '@/lib/sedi/scope-filters';

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
          storageKey: true,
          originalFilename: true,
          mimeType: true,
        },
      },
    },
  });

  if (!pratica) {
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
    (pratica.brokerId === userCompanyId && inSede(pratica.brokerSedeId)) ||
    (pratica.agenziaAssegnataId === userCompanyId && inSede(pratica.agenziaSedeId));

  if (!allowed) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  if (pratica.documenti.length === 0) {
    return NextResponse.json({ error: 'no_documents' }, { status: 404 });
  }

  const storage = getStorage();
  const entries: PdfEntry[] = [];
  for (const doc of pratica.documenti) {
    try {
      const file = await storage.get(doc.storageKey);
      const buffer = await streamToBuffer(file.stream);
      entries.push({
        buffer,
        mimeType: doc.mimeType,
        originalFilename: doc.originalFilename,
      });
    } catch (err) {
      if (err instanceof StorageNotFoundError) continue;
      throw err;
    }
  }

  if (entries.length === 0) {
    return NextResponse.json({ error: 'no_files' }, { status: 404 });
  }

  const pdfBuffer = await buildPraticaPdf(entries);
  if (!pdfBuffer) {
    return NextResponse.json({ error: 'no_files' }, { status: 404 });
  }

  // Targa solo se la pratica ha un unico veicolo (il PDF unisce tutti i doc).
  const bundleTarga =
    pratica.veicoli.length === 1 ? (pratica.veicoli[0]?.targa ?? null) : null;
  const filename = appendToFilename(
    `${pratica.codicePratica ?? pratica.id}.pdf`,
    bundleTarga,
  );
  const headers = new Headers();
  headers.set('Content-Type', 'application/pdf');
  headers.set('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
  headers.set('Content-Length', String(pdfBuffer.length));
  headers.set('Cache-Control', 'private, no-store');
  return new Response(new Uint8Array(pdfBuffer), { headers });
}
