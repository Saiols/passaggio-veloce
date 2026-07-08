import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { prisma, type Prisma } from '@pv/db';
import { getStorage, StorageNotFoundError } from '@/lib/providers/storage';
import { buildPraticaZip, streamToBuffer, zipEntryName, type ZipEntry } from '@/lib/documenti/zip';
import { getSessionContext } from '@/lib/auth/session-context';
import { toSedeScope, wherePraticaAttiva, NO_SEDE_SCOPE } from '@/lib/sedi/scope-filters';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Lo zip aggrega i documenti di TUTTE le pratiche: alziamo il timeout per gli
// account con molte pratiche (Vercel Pro consente fino a 300s).
export const maxDuration = 60;

/** Caratteri vietati nei path entry dello zip (cartella per pratica). */
function sanitizeFolder(s: string): string {
  return s.replace(/[\\/:*?"<>|]/g, '').trim() || 'pratica';
}

/**
 * Bundle ZIP con TUTTI i documenti delle pratiche dell'utente (broker o agenzia
 * assegnata), una cartella per codice pratica e nomi file differenziati
 * (tipo/owner/targa). Pensato per il broker dalla lista pratiche.
 *
 * Multi-sede: stesso scope della lista `/pratiche` (`wherePraticaAttiva`) —
 * filtra SEMPRE per `scopeIds`, anche per il proprietario in vista aggregata,
 * cosicché lo zip non includa mai pratiche che la lista corrispondente non
 * mostra. Non c'è bypass ADMIN_PIATTAFORMA: la route è già ristretta a
 * DEALER/AGENZIA a monte (comportamento preesistente).
 */
export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const companyType = session.user.companyType;
  const companyId = session.user.companyId;
  if (!companyId || (companyType !== 'DEALER' && companyType !== 'AGENZIA')) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const ctx = await getSessionContext();
  const scope = ctx ? toSedeScope(ctx) : NO_SEDE_SCOPE;
  // companyType è string a livello di tipo: dopo il guard sopra vale a runtime
  // solo 'DEALER' o 'AGENZIA', ma serve un letterale esplicito per il tipo `ruolo`.
  const ruolo: 'AGENZIA' | 'DEALER' = companyType === 'AGENZIA' ? 'AGENZIA' : 'DEALER';
  const where: Prisma.PraticaWhereInput = wherePraticaAttiva(scope, { companyId, ruolo });

  const pratiche = await prisma.pratica.findMany({
    where,
    orderBy: [{ submittedAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
    select: {
      id: true,
      codicePratica: true,
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

  const storage = getStorage();
  const entries: ZipEntry[] = [];
  for (const pratica of pratiche) {
    if (pratica.documenti.length === 0) continue;
    const folder = sanitizeFolder(pratica.codicePratica ?? pratica.id);
    for (let i = 0; i < pratica.documenti.length; i++) {
      const doc = pratica.documenti[i]!;
      try {
        const file = await storage.get(doc.storageKey);
        const buffer = await streamToBuffer(file.stream);
        entries.push({
          name: `${folder}/${zipEntryName(doc, i, { codicePratica: pratica.codicePratica })}`,
          buffer,
        });
      } catch (err) {
        if (err instanceof StorageNotFoundError) continue;
        throw err;
      }
    }
  }

  if (entries.length === 0) {
    return NextResponse.json({ error: 'no_documents' }, { status: 404 });
  }

  const zipBuffer = await buildPraticaZip(entries);
  const today = new Date().toISOString().slice(0, 10);
  const filename = `documenti-pratiche-${today}.zip`;
  const headers = new Headers();
  headers.set('Content-Type', 'application/zip');
  headers.set('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
  headers.set('Content-Length', String(zipBuffer.length));
  headers.set('Cache-Control', 'private, no-store');
  return new Response(new Uint8Array(zipBuffer), { headers });
}
