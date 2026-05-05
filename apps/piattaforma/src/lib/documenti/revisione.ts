'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { prisma } from '@pv/db';
import { isAdminPiattaforma } from '@/lib/auth/permissions';
import { sendNotification, getAdminEmails } from '@/lib/notifiche';

export type MotivoRevisione =
  | 'DOCUMENTO_NON_STANDARD'
  | 'CASO_NON_PREVISTO_DA_SCHEMA'
  | 'RICHIESTA_BROKER';

export type RichiediRevisioneResult =
  | { ok: true; bozzaId?: string }
  | { ok: false; error: string };

/**
 * Schema Documentale v7 (SD-C release 2026-05): il broker richiede una
 * revisione manuale del team PV per casi non riconosciuti dall'engine.
 * La pratica resta in BOZZA con flag richiedeRevisioneManuale=true.
 *
 * Spec: docs/schema-documentale-v7.md §"Caso non riconosciuto".
 *
 * NB: in MVP il broker chiama questa action prima di completare il wizard,
 * passando i dati raccolti finora come bozza. Il team PV vede la pratica
 * in /admin/revisioni e contatta il broker. Quando la revisione è chiusa
 * (admin chiama risolviRevisioneAction) il broker può riprendere il
 * wizard normalmente.
 */
export async function richiediRevisioneManualeAction(
  praticaId: string | null,
  motivo: MotivoRevisione,
  note: string,
): Promise<RichiediRevisioneResult> {
  const session = await auth();
  if (!session?.user?.id) redirect('/login');
  if (session.user.companyType !== 'DEALER') {
    return {
      ok: false,
      error: 'Solo i broker possono richiedere revisione manuale',
    };
  }
  const brokerId = session.user.companyId!;
  const userId = session.user.id;

  const trimmedNote = note.trim().slice(0, 1000);
  if (trimmedNote.length < 20) {
    return {
      ok: false,
      error:
        'Descrivi la situazione con almeno 20 caratteri per aiutarci a capire',
    };
  }

  let pratica: { id: string; codicePratica: string | null };

  if (praticaId) {
    // Revisione richiesta su pratica esistente in bozza
    const existing = await prisma.pratica.findUnique({
      where: { id: praticaId },
      select: { id: true, brokerId: true, stato: true, codicePratica: true },
    });
    if (!existing || existing.brokerId !== brokerId) {
      return { ok: false, error: 'Pratica non trovata' };
    }
    if (existing.stato !== 'BOZZA') {
      return {
        ok: false,
        error:
          'La revisione manuale è disponibile solo prima dell\'invio della pratica',
      };
    }
    await prisma.pratica.update({
      where: { id: praticaId },
      data: {
        richiedeRevisioneManuale: true,
        motivoRevisione: motivo,
        noteRevisione: trimmedNote,
        revisioneCompletata: false,
      },
    });
    pratica = { id: existing.id, codicePratica: existing.codicePratica };
  } else {
    // Crea una bozza placeholder con sole note di revisione (no dati pratica
    // ancora). L'admin contatta il broker direttamente.
    const created = await prisma.pratica.create({
      data: {
        tipo: 'PASSAGGIO_PRIVATO',
        stato: 'BOZZA',
        brokerId,
        richiedeRevisioneManuale: true,
        motivoRevisione: motivo,
        noteRevisione: trimmedNote,
      },
      select: { id: true, codicePratica: true },
    });
    pratica = created;
  }

  // Notifica admin platform — best effort
  try {
    const admins = await getAdminEmails();
    for (const a of admins) {
      await sendNotification({
        tipo: 'N20_ADMIN_REVISIONE_RICHIESTA',
        target: { email: a.email, userId: a.userId },
        payload: {
          praticaId: pratica.id,
          codicePratica: pratica.codicePratica ?? '(bozza)',
          motivo,
          note: trimmedNote,
          brokerUserId: userId,
        },
      }).catch(() => undefined);
    }
  } catch {
    // best-effort
  }

  revalidatePath('/admin/revisioni');
  revalidatePath('/pratiche/nuova');
  return { ok: true, bozzaId: pratica.id };
}

export type RisolviRevisioneResult =
  | { ok: true }
  | { ok: false; error: string };

/**
 * L'admin chiude la revisione manuale: aggiunge note di esito + sblocca
 * il broker che può riprendere il wizard. Notifica N21.
 */
export async function risolviRevisioneAction(
  praticaId: string,
  esito: 'RISOLTA' | 'ANNULLATA',
  noteEsito: string,
): Promise<RisolviRevisioneResult> {
  const session = await auth();
  if (!session?.user?.id) redirect('/login');
  if (!isAdminPiattaforma(session.user.role)) {
    return {
      ok: false,
      error: "Solo l'admin platform può chiudere le revisioni",
    };
  }
  const adminId = session.user.id;

  const pratica = await prisma.pratica.findUnique({
    where: { id: praticaId },
    include: {
      broker: {
        include: {
          users: {
            where: { role: 'ADMIN_AZIENDA', status: 'ACTIVE' },
            select: { id: true, email: true, nome: true },
            take: 1,
          },
        },
      },
    },
  });
  if (!pratica || !pratica.richiedeRevisioneManuale) {
    return { ok: false, error: 'Revisione non trovata o già chiusa' };
  }
  if (pratica.revisioneCompletata) {
    return { ok: false, error: 'Revisione già chiusa' };
  }

  const trimmedEsito = noteEsito.trim().slice(0, 1000);
  const now = new Date();

  await prisma.pratica.update({
    where: { id: praticaId },
    data: {
      revisioneCompletata: true,
      revisioneCompletataAt: now,
      revisioneCompletataDaId: adminId,
      // Append esito alle note di revisione (audit trail)
      noteRevisione: trimmedEsito
        ? `${pratica.noteRevisione ?? ''}\n[ESITO ${esito}] ${trimmedEsito}`
        : pratica.noteRevisione,
      // Se l'admin chiude come ANNULLATA, segnamo la pratica come tale
      ...(esito === 'ANNULLATA'
        ? { stato: 'ANNULLATA' as const, annullataAt: now }
        : { richiedeRevisioneManuale: false }),
    },
  });

  // Notifica al broker (admin del'azienda)
  try {
    const brokerUser = pratica.broker.users[0];
    if (brokerUser) {
      await sendNotification({
        tipo: 'N21_BROKER_REVISIONE_COMPLETATA',
        target: {
          email: brokerUser.email,
          userId: brokerUser.id,
          companyId: pratica.brokerId,
        },
        payload: {
          codicePratica: pratica.codicePratica ?? '(bozza)',
          nomeBroker: brokerUser.nome,
          esito,
          noteEsito: trimmedEsito,
        },
      }).catch(() => undefined);
    }
  } catch {
    // best-effort
  }

  revalidatePath('/admin/revisioni');
  revalidatePath(`/pratiche/${praticaId}`);
  revalidatePath('/pratiche/nuova');
  return { ok: true };
}
