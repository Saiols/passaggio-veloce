'use server';

import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { prisma } from '@pv/db';
import { getSessionContext } from '@/lib/auth/session-context';
import { resolveSubmittedSede } from '@/lib/sedi/scope';
import { getStorage } from '@/lib/providers/storage';
import { sendNotification, getAdminEmails } from '@/lib/notifiche';
import { buildDatiSnapshot, documentiDaBlobRefs, type InviaSegnalazioneInput } from './snapshot';

export async function inviaSegnalazioneCreazioneAction(
  input: InviaSegnalazioneInput,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
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
