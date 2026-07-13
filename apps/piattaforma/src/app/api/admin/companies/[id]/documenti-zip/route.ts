import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { prisma } from '@pv/db';
import { isAdminPiattaforma } from '@/lib/auth/permissions';
import { storageGetBuffer } from '@/lib/providers/storage';
import { documentoDownloadName } from '@/lib/documenti/labels';
import { appendToFilename } from '@/lib/documenti/filename';
import { buildDocumentiZip, type ZipEntry } from '@/lib/documenti/zip';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * ZIP di tutti i documenti di un'azienda: i documenti KYC caricati in
 * registrazione (CI, codice fiscale, visura) più il PDF del mandato di
 * fatturazione, se firmato.
 *
 * Solo ADMIN_PIATTAFORMA: sono documenti d'identità del legale rappresentante.
 * L'Assistente è già negato da `canAccessDocumento` sul download singolo
 * (api/documenti/[id]/route.ts:50) — qui la stessa regola, esplicita.
 *
 * Un file mancante nello storage NON fa fallire lo zip: si scarica ciò che c'è
 * (un blob perso non deve rendere irraggiungibili gli altri documenti).
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  if (!isAdminPiattaforma(session.user.role)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const { id } = await params;
  const company = await prisma.company.findUnique({
    where: { id },
    select: {
      ragioneSociale: true,
      deletedAt: true,
      documenti: {
        where: { deletedAt: null, praticaId: null },
        orderBy: { createdAt: 'asc' },
        select: { tipo: true, owner: true, originalFilename: true, storageKey: true },
      },
      mandatoFatturazione: {
        select: { storageKey: true, firmatoAt: true },
      },
    },
  });

  if (!company || company.deletedAt) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const entries: ZipEntry[] = [];

  for (const [i, doc] of company.documenti.entries()) {
    const buffer = await storageGetBuffer(doc.storageKey).catch(() => null);
    if (!buffer) continue;
    entries.push({
      name: documentoDownloadName(doc, { codicePratica: company.ragioneSociale, index: i }),
      buffer,
    });
  }

  const mandato = company.mandatoFatturazione;
  if (mandato?.storageKey) {
    const buffer = await storageGetBuffer(mandato.storageKey).catch(() => null);
    if (buffer) {
      // Stesso sanitizer dei documenti KYC sopra (documentoDownloadName →
      // appendToFilename → sanitizePart): la ragione sociale può contenere
      // caratteri vietati in un nome file (es. '/'), che altrimenti
      // creerebbero una cartella dentro lo ZIP invece di un file.
      const name = appendToFilename(`${company.ragioneSociale}.pdf`, 'Mandato fatturazione');
      entries.push({ name, buffer });
    }
  }

  if (entries.length === 0) {
    return NextResponse.json({ error: 'no_documents' }, { status: 404 });
  }

  const zip = await buildDocumentiZip(entries);
  const giorno = new Date().toISOString().slice(0, 10);
  const filename = `${company.ragioneSociale} - documenti - ${giorno}.zip`;

  const headers = new Headers();
  headers.set('Content-Type', 'application/zip');
  headers.set('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
  headers.set('Content-Length', String(zip.length));
  headers.set('Cache-Control', 'private, no-store');
  return new Response(new Uint8Array(zip), { headers });
}
