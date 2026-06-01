import 'server-only';
import { prisma } from '@pv/db';
import { getStorage, StorageNotFoundError } from '@/lib/providers/storage';
import { cutoffDate, DOC_HARD_DELETE_DAYS, BOZZA_PURGE_DAYS } from '@/lib/documenti/retention';

const BATCH_SIZE = 100;

export type PurgeDeletedDocumentiResult = {
  documentiHardDeleted: number;
  bozzePurged: number;
};

/**
 * 1) Hard-delete dei Documento con deletedAt < now - 90gg: rimuove il file
 *    dallo storage (best-effort) e la riga DB.
 * 2) Purga le Pratica in BOZZA con updatedAt < now - 30gg (mai finalizzate):
 *    elimina prima i documenti collegati (file + riga), poi la pratica.
 * Idempotente e batched.
 */
export async function purgeDeletedDocumenti(
  now: Date = new Date(),
): Promise<PurgeDeletedDocumentiResult> {
  const storage = getStorage();

  const docCutoff = cutoffDate(DOC_HARD_DELETE_DAYS, now);
  const staleDocs = await prisma.documento.findMany({
    where: { deletedAt: { lt: docCutoff, not: null } },
    select: { id: true, storageKey: true },
    take: BATCH_SIZE,
  });
  let documentiHardDeleted = 0;
  for (const doc of staleDocs) {
    try {
      await storage.delete(doc.storageKey);
    } catch (err) {
      if (!(err instanceof StorageNotFoundError)) throw err;
    }
    await prisma.documento.delete({ where: { id: doc.id } });
    documentiHardDeleted++;
  }

  const bozzaCutoff = cutoffDate(BOZZA_PURGE_DAYS, now);
  const staleBozze = await prisma.pratica.findMany({
    where: { stato: 'BOZZA', updatedAt: { lt: bozzaCutoff } },
    select: {
      id: true,
      documenti: { select: { id: true, storageKey: true } },
    },
    take: BATCH_SIZE,
  });
  let bozzePurged = 0;
  for (const bozza of staleBozze) {
    for (const doc of bozza.documenti) {
      try {
        await storage.delete(doc.storageKey);
      } catch (err) {
        if (!(err instanceof StorageNotFoundError)) throw err;
      }
    }
    await prisma.$transaction([
      prisma.documento.deleteMany({ where: { praticaId: bozza.id } }),
      prisma.pratica.delete({ where: { id: bozza.id } }),
    ]);
    bozzePurged++;
  }

  return { documentiHardDeleted, bozzePurged };
}
