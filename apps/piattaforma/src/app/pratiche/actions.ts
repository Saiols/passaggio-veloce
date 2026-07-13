'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { auth } from '@/auth';
import { prisma } from '@pv/db';
import { sendNotification, notifyClientiAvanzamento } from '@/lib/notifiche';
import { destinatariBroker } from '@/lib/notifiche/pratica';
import { isAgenziaBloccata } from '@/lib/fee/blocco';
import { emitEventoPratica } from '@/lib/eventi/emit';
import { eventoPraticaLavorata, eventoPraticaAnnullata } from '@/lib/eventi/pratica-eventi';
import { requirePermesso } from '@/lib/auth/permessi/guard';
import { firmaPraticaCore, sedeScopeCorrente, assertSedeInScope } from '@/lib/pratiche/firma-engine';
import type { QuickActionResult } from '@/lib/pratiche/quick-action';

// Ri-esportato per i consumer esistenti (il tipo vive in lib/pratiche/quick-action.ts:
// vedi il commento lì per il perché non sta più qui).
export type { QuickActionResult };

/**
 * Step intermedio del workflow (item 11 release 2026-05): l'agenzia segna la
 * pratica come "processata" quando ha completato la lavorazione e attende solo
 * la firma del cliente. Transizione forzata: ACCETTATA → PROCESSATA → FIRMATA.
 */
async function processaPraticaCore(praticaId: string): Promise<QuickActionResult> {
  const session = await auth();
  if (!session?.user) redirect('/login');

  // Autenticazione → permesso → scope. Copre entrambi i wrapper (dettaglio e
  // lista): il gate sta nel core, non va duplicato nei due export sotto.
  const gate = await requirePermesso('pratiche.processa');
  if (!gate.ok) return gate;

  if (session.user.companyType !== 'AGENZIA') {
    redirect('/dashboard');
  }
  const agenziaId = session.user.companyId!;
  if (await isAgenziaBloccata(agenziaId)) redirect('/blocco-pagamento');
  const scope = await sedeScopeCorrente();

  try {
    await prisma.$transaction(async (tx) => {
      const pratica = await tx.pratica.findUnique({ where: { id: praticaId } });
      if (!pratica) throw new Error('Pratica non trovata');
      if (pratica.agenziaAssegnataId !== agenziaId) {
        throw new Error('Pratica non assegnata a questa agenzia');
      }
      assertSedeInScope(pratica, agenziaId, scope);
      if (pratica.stato !== 'ACCETTATA') {
        throw new Error('Pratica non nello stato ACCETTATA');
      }

      await tx.pratica.update({
        where: { id: praticaId },
        data: {
          stato: 'PROCESSATA',
          processataAt: new Date(),
        },
      });
    });
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }

  // N13: notifica al broker che la pratica è stata processata, manca solo la firma.
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
          select: { ragioneSociale: true },
        },
        veicoli: { orderBy: { ordine: 'asc' }, select: { targa: true } },
      },
    });
    // Recapito: chi ha creato la pratica; se non è più raggiungibile la catena
    // scende alla sua sede, poi all'admin azienda. Vedi lib/notifiche/pratica.ts.
    const destinatari = await destinatariBroker(praticaId);
    if (full) {
      for (const d of destinatari) {
        await sendNotification({
          tipo: 'N13_BROKER_PRATICA_PROCESSATA',
          target: {
            email: d.email,
            userId: d.userId,
            companyId: full.broker.id,
          },
          payload: {
            codicePratica: full.codicePratica ?? '—',
            targa:
              full.veicoli[0]?.targa
                ? full.veicoli.length > 1
                  ? `${full.veicoli[0].targa} +${full.veicoli.length - 1}`
                  : full.veicoli[0].targa
                : null,
            agenziaNome: full.agenziaAssegnata?.ragioneSociale ?? '—',
            nomeBroker: d.nome,
          },
        }, { praticaId }).catch(() => undefined);
      }
    }
    if (full?.codicePratica) {
      await emitEventoPratica(
        prisma,
        eventoPraticaLavorata({
          praticaId,
          brokerId: full.broker.id,
          sedeId: full.brokerSedeId,
          codicePratica: full.codicePratica,
        }),
      ).catch(() => undefined);
    }
  } catch {
    // best-effort
  }

  // Email cliente: documenti pronti, si procede alla firma.
  await notifyClientiAvanzamento(praticaId, 'PRONTA_FIRMA').catch(() => undefined);

  revalidatePath('/dashboard');
  revalidatePath('/pratiche');
  revalidatePath(`/pratiche/${praticaId}`);
  return { ok: true };
}

/**
 * Wrapper per il DETTAGLIO pratica (form action): mantiene il comportamento
 * storico redirect + toast via query param sulla stessa pagina di dettaglio.
 */
export async function markPraticaProcessataAction(praticaId: string): Promise<void> {
  const res = await processaPraticaCore(praticaId);
  if (!res.ok) {
    redirect(`/pratiche/${praticaId}?error=${encodeURIComponent(res.error)}`);
  }
  redirect(`/pratiche/${praticaId}?processata=1`);
}

/**
 * Wrapper per la LISTA pratiche: NON naviga, ritorna l'esito così il client
 * resta sulla lista (stato aggiornato dal refresh) e mostra un toast.
 */
export async function processaPraticaFromListaAction(
  praticaId: string,
): Promise<QuickActionResult> {
  return processaPraticaCore(praticaId);
}

/** Wrapper per il DETTAGLIO pratica (form action): redirect + toast come prima. */
export async function markFirmaAvvenutaAction(praticaId: string): Promise<void> {
  const res = await firmaPraticaCore(praticaId, { tipo: 'AGENZIA' });
  if (!res.ok) {
    redirect(`/pratiche/${praticaId}?error=${encodeURIComponent(res.error)}`);
  }
  redirect(`/pratiche/${praticaId}?firmata=1`);
}

/** Wrapper per la LISTA pratiche: NON naviga, ritorna l'esito (toast lato client). */
export async function firmaFromListaAction(
  praticaId: string,
): Promise<QuickActionResult> {
  return firmaPraticaCore(praticaId, { tipo: 'AGENZIA' });
}

export async function annullaPraticaAction(praticaId: string): Promise<void> {
  const session = await auth();
  if (!session?.user) redirect('/login');

  // Autenticazione → permesso → scope.
  const gate = await requirePermesso('pratiche.annulla');
  if (!gate.ok) {
    redirect(`/pratiche/${praticaId}?error=${encodeURIComponent(gate.error)}`);
  }

  if (session.user.companyType !== 'DEALER') {
    redirect('/dashboard');
  }
  const brokerId = session.user.companyId!;
  const scope = await sedeScopeCorrente();

  let eraBozza = false;

  try {
    await prisma.$transaction(async (tx) => {
      const pratica = await tx.pratica.findUnique({ where: { id: praticaId } });
      if (!pratica) throw new Error('Pratica non trovata');
      if (pratica.brokerId !== brokerId) {
        throw new Error('Non sei il broker di questa pratica');
      }
      assertSedeInScope(pratica, brokerId, scope);
      if (pratica.stato === 'FIRMATA') {
        throw new Error('Non puoi annullare una pratica già firmata');
      }
      if (pratica.stato === 'ANNULLATA') {
        throw new Error('Pratica già annullata');
      }
      // Sistema Penali Broker: una segnalazione IN VERIFICA (RICEVUTA) blocca
      // l'annullamento. Altrimenti il broker annulla la pratica e schiva la
      // penale — quando l'admin la conferma, `segnalazione.ts` trova la pratica
      // ANNULLATA e lancia 'Pratica non più gestibile': la penale non viene mai
      // addebitata e la segnalazione resta appesa per sempre nella coda admin.
      // Non blocca invece se la segnalazione è già stata RESPINTA (resetta
      // flagSegnalata) o se non c'è mai stata.
      if (pratica.flagSegnalata && pratica.segnalazioneStato === 'RICEVUTA') {
        throw new Error(
          'Pratica con segnalazione in verifica: non puoi annullarla finché il team non ha deciso.',
        );
      }

      eraBozza = pratica.stato === 'BOZZA';

      const now = new Date();

      await tx.pratica.update({
        where: { id: praticaId },
        data: {
          stato: 'ANNULLATA',
          annullataAt: now,
        },
      });

      await tx.praticaAssegnazione.updateMany({
        where: { praticaId, esito: 'PENDING' },
        data: { esito: 'ASSEGNATA_ALTRO', esitoAt: now },
      });
    });
  } catch (err) {
    redirect(`/pratiche/${praticaId}?error=${encodeURIComponent((err as Error).message)}`);
  }

  // Se la pratica era già accettata, l'agenzia assegnata vede l'annullamento.
  try {
    const p = await prisma.pratica.findUnique({
      where: { id: praticaId },
      select: { agenziaAssegnataId: true, agenziaSedeId: true, codicePratica: true },
    });
    if (p?.agenziaAssegnataId && p.codicePratica) {
      await emitEventoPratica(
        prisma,
        eventoPraticaAnnullata({
          praticaId,
          agenziaId: p.agenziaAssegnataId,
          sedeId: p.agenziaSedeId,
          codicePratica: p.codicePratica,
        }),
      );
    }
  } catch {
    // best-effort
  }

  // Email cliente: pratica annullata. Solo se era stata realmente inviata
  // (mai notificato "avviata" per le bozze -> niente "annullata").
  if (!eraBozza) {
    await notifyClientiAvanzamento(praticaId, 'ANNULLATA').catch(() => undefined);
  }

  revalidatePath('/dashboard');
  revalidatePath('/pratiche');
  revalidatePath(`/pratiche/${praticaId}`);
  redirect(`/pratiche/${praticaId}?annullata=1`);
}

const valutazioneSchema = z.object({
  praticaId: z.string().uuid(),
  stelle: z.coerce.number().int().min(1).max(5),
  note: z.string().trim().max(500).optional(),
});

type ActionResult = { ok: true } | { ok: false; error: string };

export async function submitValutazioneAction(formData: FormData): Promise<ActionResult> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: 'Non autenticato' };

  // Autenticazione → permesso → scope.
  const gate = await requirePermesso('pratiche.valuta');
  if (!gate.ok) return gate;

  if (session.user.companyType !== 'DEALER') {
    return { ok: false, error: 'Solo i broker possono valutare le agenzie' };
  }
  const dealerId = session.user.companyId;
  if (!dealerId) return { ok: false, error: 'Azienda non associata' };
  const scope = await sedeScopeCorrente();

  const parsed = valutazioneSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return {
      ok: false,
      error: first ? `${first.path.join('.')}: ${first.message}` : 'Dati non validi',
    };
  }
  const { praticaId, stelle, note } = parsed.data;

  try {
    await prisma.$transaction(async (tx) => {
      const pratica = await tx.pratica.findUnique({
        where: { id: praticaId },
        include: { valutazione: true },
      });
      if (!pratica) throw new Error('Pratica non trovata');
      if (pratica.brokerId !== dealerId) throw new Error('Non sei il broker di questa pratica');
      assertSedeInScope(pratica, dealerId, scope);
      if (pratica.stato !== 'FIRMATA') throw new Error('Puoi valutare solo pratiche firmate');
      if (!pratica.agenziaAssegnataId) throw new Error('Nessuna agenzia assegnata');
      if (pratica.valutazione) throw new Error('Hai già valutato questa pratica');

      await tx.valutazione.create({
        data: {
          praticaId,
          agenziaId: pratica.agenziaAssegnataId,
          dealerId,
          // Multi-sede: sede agenzia valutata + sede broker che vota.
          agenziaSedeId: pratica.agenziaSedeId,
          brokerSedeId: pratica.brokerSedeId,
          stelle,
          note: note ?? null,
        },
      });
    });
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }

  revalidatePath(`/pratiche/${praticaId}`);
  revalidatePath('/dashboard');
  return { ok: true };
}
