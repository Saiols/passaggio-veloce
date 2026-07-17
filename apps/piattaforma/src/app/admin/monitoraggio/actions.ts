'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { prisma } from '@pv/db';
import { avviaRound, processPostCommitJobs } from '@/lib/distribuzione/tick';
import { logCambioStato, STATO_EVENTO } from '@/lib/pratiche/stato-log';
import { sendNotification, notifyClientiAvanzamento } from '@/lib/notifiche';
import { destinatariSedeAgenzia, destinatariBroker } from '@/lib/notifiche/pratica';
import { emitEventoPratica } from '@/lib/eventi/emit';
import { eventoPraticaRevocata } from '@/lib/eventi/pratica-eventi';
import { isAdminPiattaforma } from '@/lib/auth/permissions';

export type RevocaResult = { ok: true } | { ok: false; error: string };

/**
 * Revoca una pratica accettata-non-lavorata e la rimette in distribuzione:
 * sgancia l'agenzia (esito REVOCATA_ADMIN, esclusione permanente), incrementa il
 * ciclo e riavvia il round 1 sulla zona. Poi informa agenzia revocata, broker e
 * clienti. Best-effort per email/eventi. Solo super-admin.
 */
export async function revocaERimettiInCircoloAction(
  praticaId: string,
  motivo?: string,
): Promise<RevocaResult> {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if (!isAdminPiattaforma(session.user.role)) {
    return { ok: false, error: 'Solo il super-admin può revocare una pratica' };
  }
  const motivoPulito = motivo?.trim() || null;
  const adminId = session.user.id;

  try {
    const outcome = await prisma.$transaction(async (tx) => {
      const pratica = await tx.pratica.findUnique({
        where: { id: praticaId },
        select: {
          id: true,
          stato: true,
          provincia: true,
          processataAt: true,
          distribuzioneCiclo: true,
          agenziaAssegnataId: true,
          agenziaSedeId: true,
          brokerId: true,
          codicePratica: true,
          veicoli: { orderBy: { ordine: 'asc' }, select: { targa: true } },
        },
      });
      if (!pratica) throw new Error('Pratica non trovata');
      if (pratica.stato !== 'ACCETTATA' || pratica.processataAt !== null) {
        throw new Error('La pratica non è in stato accettato/non lavorato');
      }

      const revokedSedeId = pratica.agenziaSedeId;
      const revokedCompanyId = pratica.agenziaAssegnataId;
      const nuovoCiclo = pratica.distribuzioneCiclo + 1;

      // 1) l'assegnazione vincente del ciclo corrente → revocata (esclusione permanente)
      await tx.praticaAssegnazione.updateMany({
        where: { praticaId, ciclo: pratica.distribuzioneCiclo, esito: 'ACCETTATA' },
        data: { esito: 'REVOCATA_ADMIN', esitoAt: new Date(), notaRifiuto: motivoPulito },
      });

      // 2) sgancia l'agenzia e apri il nuovo ciclo (lo stato lo imposta avviaRound)
      // compare-and-set: ri-asserisce stato/ciclo per evitare doppia revoca in race
      const cas = await tx.pratica.updateMany({
        where: {
          id: praticaId,
          stato: 'ACCETTATA',
          processataAt: null,
          distribuzioneCiclo: pratica.distribuzioneCiclo,
        },
        data: {
          agenziaAssegnataId: null,
          agenziaSedeId: null,
          accettataAt: null,
          accettataDaUserId: null,
          distribuzioneCiclo: nuovoCiclo,
          round1StartedAt: null,
          round2StartedAt: null,
          round3StartedAt: null,
          escalationAt: null,
        },
      });
      if (cas.count === 0) {
        throw new Error('La pratica non è più in stato accettato/non lavorato');
      }

      // 3) ricarica le assegnazioni (incl. la REVOCATA_ADMIN appena scritta)
      const assegnazioni = await tx.praticaAssegnazione.findMany({
        where: { praticaId },
        select: { sedeId: true, ciclo: true, esito: true },
      });

      // 4) riparti dal round 1 sul nuovo ciclo: ricontatta la zona, esclude la revocata
      const r = await avviaRound(
        tx,
        { id: praticaId, provincia: pratica.provincia, distribuzioneCiclo: nuovoCiclo, assegnazioni },
        1,
      );

      await logCambioStato(tx, {
        praticaId,
        statoDa: 'ACCETTATA',
        statoA: r.escalated ? 'IN_ESCALATION' : 'IN_ATTESA_ROUND_1',
        tipoEvento: STATO_EVENTO.RECIRCULATE,
        attoreUserId: adminId,
        motivo: motivoPulito,
        meta: { ciclo: nuovoCiclo, revokedSedeId, round: 1, escalated: r.escalated },
      });

      const targa = pratica.veicoli[0]?.targa
        ? pratica.veicoli.length > 1
          ? `${pratica.veicoli[0].targa} +${pratica.veicoli.length - 1}`
          : pratica.veicoli[0].targa
        : null;

      return {
        newAssegnazioniIds: r.newAssegnazioniIds,
        escalated: r.escalated,
        revokedSedeId,
        revokedCompanyId,
        brokerId: pratica.brokerId,
        codicePratica: pratica.codicePratica,
        targa,
      };
    });

    // 5) N6 + popup alle nuove sedi in zona (la revocata è esclusa a monte)
    await processPostCommitJobs({
      newAssegnazioniIds: outcome.newAssegnazioniIds,
      escalationPraticaId: outcome.escalated ? praticaId : null,
    }).catch(() => undefined);

    // 6) email + evento all'agenzia revocata
    if (outcome.revokedSedeId && outcome.revokedCompanyId && outcome.codicePratica) {
      const destinatari = await destinatariSedeAgenzia(outcome.revokedSedeId).catch(() => []);
      for (const d of destinatari) {
        await sendNotification({
          tipo: 'N50_AGENZIA_PRATICA_REVOCATA',
          target: { email: d.email, userId: d.userId, companyId: outcome.revokedCompanyId },
          payload: {
            codicePratica: outcome.codicePratica,
            targa: outcome.targa,
            nomeAgenzia: d.nome,
            motivo: motivoPulito,
          },
        }).catch(() => undefined);
      }
      await emitEventoPratica(
        prisma,
        eventoPraticaRevocata({
          praticaId,
          agenziaId: outcome.revokedCompanyId,
          sedeId: outcome.revokedSedeId,
          codicePratica: outcome.codicePratica,
        }),
      ).catch(() => undefined);
    }

    // 7) email al broker
    if (outcome.codicePratica) {
      const destinatariB = await destinatariBroker(praticaId).catch(() => []);
      for (const d of destinatariB) {
        await sendNotification({
          tipo: 'N51_BROKER_PRATICA_RIMESSA_IN_CIRCOLO',
          target: { email: d.email, userId: d.userId, companyId: outcome.brokerId },
          payload: { codicePratica: outcome.codicePratica, targa: outcome.targa, nomeBroker: d.nome },
        }).catch(() => undefined);
      }
    }

    // 8) email a venditori + acquirenti
    await notifyClientiAvanzamento(praticaId, 'RIMESSA_IN_CIRCOLO').catch(() => undefined);

    revalidatePath('/admin/monitoraggio');
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Errore sconosciuto' };
  }
}
