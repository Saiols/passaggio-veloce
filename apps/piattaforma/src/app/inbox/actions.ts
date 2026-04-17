'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { prisma } from '@pv/db';
import { tickPratica } from '@/lib/distribuzione';
import { sendNotification } from '@/lib/notifiche';

type ActionResult = { ok: true } | { ok: false; error: string };

export async function acceptPratica(praticaId: string): Promise<ActionResult> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: 'Non autenticato' };
  if (session.user.companyType !== 'AGENZIA') {
    return { ok: false, error: 'Solo le agenzie possono accettare pratiche' };
  }
  const agenziaId = session.user.companyId;
  if (!agenziaId) return { ok: false, error: 'Azienda non associata' };

  try {
    await prisma.$transaction(async (tx) => {
      const assegnazione = await tx.praticaAssegnazione.findFirst({
        where: { praticaId, agenziaId, esito: 'PENDING' },
      });
      if (!assegnazione) {
        throw new Error(
          'Pratica non disponibile: già accettata da un altra agenzia o non assegnata a te.',
        );
      }

      const pratica = await tx.pratica.findUnique({ where: { id: praticaId } });
      if (!pratica) throw new Error('Pratica non trovata');
      if (
        pratica.stato !== 'IN_ATTESA_ROUND_1' &&
        pratica.stato !== 'IN_ATTESA_ROUND_2' &&
        pratica.stato !== 'IN_ATTESA_ROUND_3'
      ) {
        throw new Error('Pratica non più in distribuzione');
      }

      const now = new Date();

      await tx.praticaAssegnazione.update({
        where: { id: assegnazione.id },
        data: { esito: 'ACCETTATA', esitoAt: now },
      });

      await tx.praticaAssegnazione.updateMany({
        where: {
          praticaId,
          esito: 'PENDING',
          id: { not: assegnazione.id },
        },
        data: { esito: 'ASSEGNATA_ALTRO', esitoAt: now },
      });

      await tx.pratica.update({
        where: { id: praticaId },
        data: {
          stato: 'ACCETTATA',
          agenziaAssegnataId: agenziaId,
          accettataAt: now,
        },
      });
    });
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }

  // N2 — notifica broker che l'agenzia ha accettato
  try {
    const full = await prisma.pratica.findUnique({
      where: { id: praticaId },
      include: {
        broker: {
          include: {
            users: {
              where: { role: 'ADMIN_AZIENDA', status: 'ACTIVE' },
              select: { email: true, nome: true, id: true },
              take: 1,
            },
          },
        },
        agenziaAssegnata: {
          select: { ragioneSociale: true, citta: true, email: true, telefono: true },
        },
      },
    });
    const broker = full?.broker;
    const brokerUser = broker?.users[0];
    const agenzia = full?.agenziaAssegnata;
    if (full && broker && brokerUser && agenzia) {
      await sendNotification({
        tipo: 'N2_BROKER_ACCETTATA',
        target: { email: brokerUser.email, userId: brokerUser.id, companyId: broker.id },
        payload: {
          codicePratica: full.codicePratica ?? '—',
          targa: full.targa,
          agenziaNome: agenzia.ragioneSociale,
          agenziaCitta: agenzia.citta,
          agenziaEmail: agenzia.email,
          agenziaTelefono: agenzia.telefono,
          nomeBroker: brokerUser.nome,
        },
      }).catch(() => undefined);
    }
  } catch {
    // best-effort, non blocca
  }

  revalidatePath('/inbox');
  revalidatePath('/dashboard');
  revalidatePath('/pratiche');
  revalidatePath(`/inbox/${praticaId}`);
  return { ok: true };
}

export async function rejectPratica(
  praticaId: string,
  formData: FormData,
): Promise<ActionResult> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: 'Non autenticato' };
  if (session.user.companyType !== 'AGENZIA') {
    return { ok: false, error: 'Solo le agenzie possono rifiutare pratiche' };
  }
  const agenziaId = session.user.companyId;
  if (!agenziaId) return { ok: false, error: 'Azienda non associata' };

  const notaRaw = formData.get('nota');
  const nota = typeof notaRaw === 'string' && notaRaw.trim() ? notaRaw.trim().slice(0, 500) : null;

  const assegnazione = await prisma.praticaAssegnazione.findFirst({
    where: { praticaId, agenziaId, esito: 'PENDING' },
  });
  if (!assegnazione) {
    return { ok: false, error: 'Assegnazione non trovata o già chiusa' };
  }

  await prisma.praticaAssegnazione.update({
    where: { id: assegnazione.id },
    data: { esito: 'RIFIUTATA', esitoAt: new Date(), notaRifiuto: nota },
  });

  // Se era l'ultima PENDING del round corrente, l'engine fa avanzare round / escalation
  await tickPratica(praticaId);

  revalidatePath('/inbox');
  revalidatePath('/dashboard');
  revalidatePath(`/inbox/${praticaId}`);
  return { ok: true };
}

export async function acceptAndRedirect(praticaId: string): Promise<void> {
  const result = await acceptPratica(praticaId);
  if (!result.ok) {
    redirect(`/inbox/${praticaId}?error=${encodeURIComponent(result.error)}`);
  }
  redirect(`/pratiche/${praticaId}`);
}

export async function rejectAndRedirect(
  praticaId: string,
  formData: FormData,
): Promise<void> {
  const result = await rejectPratica(praticaId, formData);
  if (!result.ok) {
    redirect(`/inbox/${praticaId}?error=${encodeURIComponent(result.error)}`);
  }
  redirect('/inbox');
}
