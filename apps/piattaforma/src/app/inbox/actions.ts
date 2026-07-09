'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { getSessionContext } from '@/lib/auth/session-context';
import { prisma } from '@pv/db';
import { tickPratica } from '@/lib/distribuzione';
import { sendNotification, notifyClientiAvanzamento } from '@/lib/notifiche';
import { isAgenziaBloccata } from '@/lib/fee/blocco';
import { emitEventoPratica, dismissNuovaPraticaEventi } from '@/lib/eventi/emit';
import { eventoPraticaAccettata } from '@/lib/eventi/pratica-eventi';

type ActionResult = { ok: true } | { ok: false; error: string };

export async function acceptPratica(praticaId: string): Promise<ActionResult> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: 'Non autenticato' };
  if (session.user.companyType !== 'AGENZIA') {
    return { ok: false, error: 'Solo le agenzie possono accettare pratiche' };
  }
  const agenziaId = session.user.companyId;
  if (!agenziaId) return { ok: false, error: 'Azienda non associata' };

  if (await isAgenziaBloccata(agenziaId)) {
    return { ok: false, error: 'Account sospeso per addebito non riuscito: aggiorna l\'IBAN in /blocco-pagamento' };
  }

  // Multi-sede: l'assegnazione da accettare è quella di una sede a cui l'utente
  // ha accesso (scopeIds). La sede accettante è registrata sulla pratica.
  const ctx = await getSessionContext();
  const scopeIds = ctx?.scopeIds ?? [];

  try {
    await prisma.$transaction(async (tx) => {
      const assegnazione = await tx.praticaAssegnazione.findFirst({
        where: { praticaId, sedeId: { in: scopeIds }, esito: 'PENDING' },
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
          agenziaAssegnataId: assegnazione.agenziaId,
          agenziaSedeId: assegnazione.sedeId,
          accettataAt: now,
          // Chi accetta è chi seguirà la pratica: le email successive (promemoria
          // firma, segnalazione confermata) devono arrivare a lui, non alla madre.
          accettataDaUserId: session.user.id,
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
              where: { role: 'ADMIN_AZIENDA', status: 'ACTIVE', deletedAt: null },
              select: { email: true, nome: true, id: true },
              take: 1,
            },
          },
        },
        agenziaAssegnata: {
          select: {
            ragioneSociale: true,
            indirizzo: true,
            cap: true,
            citta: true,
            provincia: true,
            email: true,
            telefono: true,
          },
        },
        veicoli: { orderBy: { ordine: 'asc' }, select: { targa: true } },
      },
    });
    const broker = full?.broker;
    const brokerUser = broker?.users[0];
    const agenzia = full?.agenziaAssegnata;
    // Recapito broker: preferisci l'admin azienda attivo, ma ripiega sull'email
    // dell'azienda se manca (account non ancora attivo o pratica creata da un
    // collaboratore) così la notifica non viene mai persa in silenzio (vedi N3).
    const brokerEmail = brokerUser?.email ?? broker?.email;
    if (full && broker && brokerEmail && agenzia) {
      await sendNotification({
        tipo: 'N2_BROKER_ACCETTATA',
        target: { email: brokerEmail, userId: brokerUser?.id ?? null, companyId: broker.id },
        payload: {
          codicePratica: full.codicePratica ?? '—',
          targa:
            full.veicoli[0]?.targa
              ? full.veicoli.length > 1
                ? `${full.veicoli[0].targa} +${full.veicoli.length - 1}`
                : full.veicoli[0].targa
              : null,
          agenziaNome: agenzia.ragioneSociale,
          agenziaIndirizzo: agenzia.indirizzo,
          agenziaCap: agenzia.cap,
          agenziaCitta: agenzia.citta,
          agenziaProvincia: agenzia.provincia,
          agenziaEmail: agenzia.email,
          agenziaTelefono: agenzia.telefono,
          nomeBroker: brokerUser?.nome ?? broker.ragioneSociale,
        },
      }).catch(() => undefined);
    }
  } catch {
    // best-effort, non blocca
  }

  // Email cliente: un'agenzia ha preso in carico la pratica.
  await notifyClientiAvanzamento(praticaId, 'PRESA_IN_CARICO').catch(() => undefined);

  // Evento in-app (modale) per il broker + auto-dismiss dei "nuova pratica"
  // ancora non visti delle altre agenzie per questa pratica.
  try {
    await dismissNuovaPraticaEventi(prisma, praticaId, agenziaId);
    const p = await prisma.pratica.findUnique({
      where: { id: praticaId },
      select: {
        brokerId: true,
        brokerSedeId: true,
        codicePratica: true,
        agenziaAssegnata: { select: { ragioneSociale: true } },
      },
    });
    if (p?.codicePratica) {
      await emitEventoPratica(
        prisma,
        eventoPraticaAccettata({
          praticaId,
          brokerId: p.brokerId,
          sedeId: p.brokerSedeId,
          codicePratica: p.codicePratica,
          agenziaNome: p.agenziaAssegnata?.ragioneSociale,
        }),
      );
    }
  } catch {
    // best-effort
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

  const ctx = await getSessionContext();
  const scopeIds = ctx?.scopeIds ?? [];

  const notaRaw = formData.get('nota');
  const nota = typeof notaRaw === 'string' && notaRaw.trim() ? notaRaw.trim().slice(0, 500) : null;

  const assegnazione = await prisma.praticaAssegnazione.findFirst({
    where: { praticaId, sedeId: { in: scopeIds }, esito: 'PENDING' },
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
