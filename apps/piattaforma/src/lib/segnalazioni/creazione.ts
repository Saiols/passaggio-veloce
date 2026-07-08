// NB: nessun `'use server'` a livello di file — questo modulo esporta anche
// helper puri sincroni (`buildDatiSnapshot`, `documentiDaBlobRefs`) che
// verrebbero validati come Server Action e romperebbero la build ("A 'use
// server' file can only export async functions"). La direttiva è quindi
// inline solo sulla funzione action, come da doc Next.js.
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { prisma, type Prisma, type TipoProblemaSegnalazione } from '@pv/db';
import { getSessionContext } from '@/lib/auth/session-context';
import { resolveSubmittedSede } from '@/lib/sedi/scope';
import { getStorage } from '@/lib/providers/storage';
import { sendNotification, getAdminEmails } from '@/lib/notifiche';

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

export async function inviaSegnalazioneCreazioneAction(
  input: InviaSegnalazioneInput,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  'use server';
  const session = await auth();
  if (!session?.user?.id) redirect('/login');
  if (session.user.companyType !== 'DEALER') {
    return { ok: false, error: 'Solo i broker possono inviare segnalazioni' };
  }
  const companyId = session.user.companyId;
  const userId = session.user.id;
  if (!companyId) return { ok: false, error: 'Azienda non associata' };

  const descrizione = input.descrizione.trim().slice(0, 1000);
  if (descrizione.length < 20) {
    return { ok: false, error: 'Descrivi il problema con almeno 20 caratteri' };
  }
  const step = Number.isInteger(input.step) && input.step >= 1 && input.step <= 4 ? input.step : 1;

  const ctx = await getSessionContext();
  const sede = ctx
    ? resolveSubmittedSede({
        submittedId: input.brokerSedeId ?? null,
        currentSede: ctx.currentSede,
        accessibleSedi: ctx.accessibleSedi,
      })
    : null;

  const datiSnapshot = buildDatiSnapshot(input.datiGrezzi, input.blobRefs);
  const documenti = documentiDaBlobRefs(input.blobRefs, {
    userId,
    storageProvider: getStorage().name,
  });

  const seg = await prisma.$transaction(async (tx) => {
    const created = await tx.segnalazioneCreazione.create({
      data: {
        companyId,
        userId,
        sedeId: sede?.id ?? null,
        step,
        tipo: input.tipo,
        descrizione,
        datiSnapshot,
      },
      select: { id: true },
    });
    if (documenti.length > 0) {
      await tx.documento.createMany({
        data: documenti.map((d) => ({ ...d, segnalazioneId: created.id })),
      });
    }
    return created;
  });

  // Notifica admin — best effort (non blocca l'invio).
  try {
    const admins = await getAdminEmails();
    for (const a of admins) {
      await sendNotification({
        tipo: 'N41_ADMIN_NUOVA_SEGNALAZIONE_CREAZIONE',
        target: { email: a.email, userId: a.userId },
        payload: {
          segnalazioneId: seg.id,
          ragioneSociale: session.user.companyName ?? '—',
          step,
          tipo: input.tipo,
          estratto: descrizione.slice(0, 200),
        },
      }).catch(() => undefined);
    }
  } catch {
    // best-effort
  }

  return { ok: true, id: seg.id };
}
