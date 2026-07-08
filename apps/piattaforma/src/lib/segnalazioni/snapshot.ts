import type { Prisma, TipoProblemaSegnalazione } from '@pv/db';

export type BlobRefInput = { key: string; name: string; size: number; type: string };

export type InviaSegnalazioneInput = {
  step: number;
  tipo: TipoProblemaSegnalazione;
  descrizione: string;
  /** Payload grezzo dello stato wizard (veicoli/venditori/acquirente/…), non validato. */
  datiGrezzi: unknown;
  blobRefs: Record<string, BlobRefInput>;
  brokerSedeId?: string | null;
};

/** Snapshot leggibile: i dati grezzi + la mappa slot→file (i byte stanno nei Documenti). */
export function buildDatiSnapshot(
  datiGrezzi: unknown,
  blobRefs: Record<string, BlobRefInput>,
): Prisma.JsonObject {
  const allegati = Object.entries(blobRefs).map(([slot, r]) => ({
    slot,
    filename: r.name,
    mimeType: r.type,
  }));
  const base =
    datiGrezzi && typeof datiGrezzi === 'object' ? (datiGrezzi as Record<string, unknown>) : {};
  return { ...base, allegati } as Prisma.JsonObject;
}

/** Una riga Documento per blobRef. tipo ALTRO: la mappa slot→file vive nello snapshot. */
export function documentiDaBlobRefs(
  blobRefs: Record<string, BlobRefInput>,
  ctx: { userId: string; storageProvider: string },
) {
  return Object.values(blobRefs)
    .filter((r) => r && typeof r.key === 'string' && r.key.length > 0)
    .map((r) => ({
      tipo: 'ALTRO' as const,
      storageKey: r.key,
      storageProvider: ctx.storageProvider,
      mimeType: r.type,
      sizeBytes: r.size,
      originalFilename: r.name,
      uploadedById: ctx.userId,
    }));
}
