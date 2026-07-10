'use server';

import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { prisma } from '@pv/db';
import { getSessionContext } from '@/lib/auth/session-context';
import { requirePermesso } from '@/lib/auth/permessi/guard';
import { resolveSubmittedSede } from '@/lib/sedi/scope';
import { getStorage } from '@/lib/providers/storage';
import { sendNotification, getAdminEmails } from '@/lib/notifiche';
import { isAdminPiattaforma } from '@/lib/auth/permissions';
import { buildDatiSnapshot, documentiDaBlobRefs, type InviaSegnalazioneInput } from './snapshot';

export async function inviaSegnalazioneCreazioneAction(
  input: InviaSegnalazioneInput,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const session = await auth();
  if (!session?.user?.id) redirect('/login');

  // Autenticazione → permesso → scope. Stesso gate delle sei action OCR: chi
  // non crea pratiche non ha motivo di segnalare un problema di creazione.
  const gate = await requirePermesso('pratiche.create');
  if (!gate.ok) return gate;

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

export async function gestisciSegnalazioneCreazioneAction(
  id: string,
  nota: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await auth();
  if (!session?.user?.id) redirect('/login');
  if (!isAdminPiattaforma(session.user.role)) {
    return { ok: false, error: "Solo l'admin piattaforma può gestire le segnalazioni" };
  }
  const notaClean = nota.trim().slice(0, 2000);
  if (notaClean.length === 0) {
    return { ok: false, error: 'Scrivi una risposta prima di chiudere la segnalazione' };
  }

  const seg = await prisma.segnalazioneCreazione.findUnique({
    where: { id },
    select: { id: true, stato: true, userId: true, user: { select: { email: true, nome: true } } },
  });
  if (!seg) return { ok: false, error: 'Segnalazione non trovata' };
  if (seg.stato === 'GESTITA') return { ok: false, error: 'Segnalazione già gestita' };

  await prisma.segnalazioneCreazione.update({
    where: { id },
    data: {
      stato: 'GESTITA',
      notaGestione: notaClean,
      gestitaAt: new Date(),
      gestitaDaId: session.user.id,
    },
  });

  // Risposta al broker — best effort.
  if (seg.user?.email) {
    await sendNotification({
      tipo: 'N42_BROKER_SEGNALAZIONE_GESTITA',
      target: { email: seg.user.email, userId: seg.userId },
      payload: { nota: notaClean, nomeBroker: seg.user.nome ?? '' },
    }).catch(() => undefined);
  }

  return { ok: true };
}
