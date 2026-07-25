'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { getSessionContext } from '@/lib/auth/session-context';
import { requirePermesso } from '@/lib/auth/permessi/guard';
import { prisma } from '@pv/db';
import { tickPratica } from '@/lib/distribuzione';
import { sendNotification, notifyClientiAvanzamento } from '@/lib/notifiche';
import { destinatariBroker } from '@/lib/notifiche/pratica';
import { isAgenziaBloccata } from '@/lib/fee/blocco';
import { isVisuraScadutaCompany } from '@/lib/visura/stato';
import { emitEventoPratica, dismissNuovaPraticaEventi } from '@/lib/eventi/emit';
import { eventoPraticaAccettata } from '@/lib/eventi/pratica-eventi';
import { logCambioStato, STATO_EVENTO } from '@/lib/pratiche/stato-log';

type ActionResult = { ok: true } | { ok: false; error: string };

export async function acceptPratica(praticaId: string): Promise<ActionResult> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: 'Non autenticato' };

  // Autenticazione → permesso → scope. Copre anche `acceptAndRedirect`, che
  // chiama questa funzione e ne propaga l'esito senza duplicare la logica.
  const gate = await requirePermesso('inbox.gestisci');
  if (!gate.ok) return gate;

  if (session.user.companyType !== 'AGENZIA') {
    return { ok: false, error: 'Solo le agenzie possono accettare pratiche' };
  }
  const agenziaId = session.user.companyId;
  if (!agenziaId) return { ok: false, error: 'Azienda non associata' };

  if (await isAgenziaBloccata(agenziaId)) {
    // Clausola 12.1 dei Termini: questa è una limitazione OPERATIVA, non una
    // sospensione — l'account resta accessibile, è solo esclusa la gestione
    // delle pratiche. Il messaggio non deve dire "sospeso" (contraddirebbe
    // esplicitamente la clausola, che lo nega).
    return {
      ok: false,
      error:
        "Operatività sospesa per addebito non riuscito: regolarizza il pagamento in /blocco-pagamento per tornare a lavorare le pratiche.",
    };
  }

  if (await isVisuraScadutaCompany(agenziaId)) {
    // Ciclo di vita della visura camerale (clausola 8 dei Termini): stessa
    // natura del check sopra — è una limitazione OPERATIVA, non una
    // sospensione dell'account (l'account resta accessibile). Il messaggio
    // non deve dire "sospeso"/"account sospeso".
    return {
      ok: false,
      error:
        'La visura camerale della tua azienda è scaduta: aggiornala in /visura per tornare a lavorare le pratiche.',
    };
  }

  // Multi-sede: l'assegnazione da accettare è quella di una sede a cui l'utente
  // ha accesso (scopeIds). La sede accettante è registrata sulla pratica.
  const ctx = await getSessionContext();
  const scopeIds = ctx?.scopeIds ?? [];

  try {
    await prisma.$transaction(async (tx) => {
      // Serializzazione anti doppia-accettazione: prende un row lock Postgres
      // sulla riga pratica PRIMA di leggere assegnazione/stato. Senza, due
      // accept concorrenti sulla stessa pratica leggerebbero entrambe
      // "PENDING per la mia sede" e "stato IN_DISTRIBUZIONE" (READ COMMITTED)
      // e vincerebbero entrambe. Con il `FOR UPDATE` il secondo accept blocca
      // finché il primo non committa, poi rilegge stato='ACCETTATA' → rifiutato
      // qui sotto. "Primo atomico": vince chi accetta per primo, non chi ha il
      // raggio minore.
      await tx.$queryRaw`SELECT id FROM "pratiche" WHERE id = ${praticaId}::uuid FOR UPDATE`;

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
      if (pratica.stato !== 'IN_DISTRIBUZIONE') {
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
          // Round in cui la pratica è stata presa: dato admin-only, alimenta la
          // media "entro quanto vengono accettate" (/admin/distribuzione).
          // Scritto qui, sotto il row lock, così non esiste un istante in cui
          // la pratica è ACCETTATA senza il round che l'ha portata lì.
          roundAccettazione: assegnazione.round,
          // Chi accetta è chi seguirà la pratica: le email successive (promemoria
          // firma, segnalazione confermata) devono arrivare a lui, non alla madre.
          accettataDaUserId: session.user.id,
        },
      });

      await logCambioStato(tx, {
        praticaId,
        statoDa: pratica.stato,
        statoA: 'ACCETTATA',
        tipoEvento: STATO_EVENTO.ACCEPT,
        attoreUserId: session.user.id,
        meta: { sedeId: assegnazione.sedeId, round: assegnazione.round },
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
    const agenzia = full?.agenziaAssegnata;
    // Recapito: chi ha creato la pratica; se non è più raggiungibile la catena
    // scende alla sua sede, poi all'admin azienda. Vedi lib/notifiche/pratica.ts.
    const destinatari = await destinatariBroker(praticaId);
    if (full && broker && agenzia && destinatari.length > 0) {
      for (const d of destinatari) {
        await sendNotification({
          tipo: 'N2_BROKER_ACCETTATA',
          target: { email: d.email, userId: d.userId, companyId: broker.id },
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
            nomeBroker: d.nome,
          },
        }, { praticaId }).catch(() => undefined);
      }
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

  // Autenticazione → permesso → scope. Copre anche `rejectAndRedirect`.
  const gate = await requirePermesso('inbox.gestisci');
  if (!gate.ok) return gate;

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
