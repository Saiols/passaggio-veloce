'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { prisma } from '@pv/db';
import { avviaRound1ForPratica } from '@/lib/distribuzione/tick';
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
 * ciclo, resetta lo stato di espansione (raggio corrente / ultima espansione /
 * zona non coperta) e la riporta in `IN_DISTRIBUZIONE`; poi il primo anello
 * riparte via `avviaRound1ForPratica` (transazione propria + N6/evento
 * post-commit). Infine informa agenzia revocata, broker e clienti. Best-effort
 * per email/eventi. Solo super-admin.
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
          lat: true,
          lng: true,
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

      // 2) sgancia l'agenzia, apri il nuovo ciclo e riporta in IN_DISTRIBUZIONE
      // azzerando lo stato di espansione (v2): ring1 riparte dopo il commit.
      // compare-and-set: ri-asserisce stato/ciclo per evitare doppia revoca in race
      const cas = await tx.pratica.updateMany({
        where: {
          id: praticaId,
          stato: 'ACCETTATA',
          processataAt: null,
          distribuzioneCiclo: pratica.distribuzioneCiclo,
        },
        data: {
          stato: 'IN_DISTRIBUZIONE',
          agenziaAssegnataId: null,
          agenziaSedeId: null,
          accettataAt: null,
          accettataDaUserId: null,
          distribuzioneCiclo: nuovoCiclo,
          // Reset stato espansione (ring1 li reimposta correttamente).
          raggioCorrenteM: null,
          ultimaEspansioneAt: null,
          zonaNonCopertaAt: null,
          // Anzianità "zona non coperta": è per-ciclo, e qui il ciclo cambia.
          // Senza questo azzeramento il nuovo giro nascerebbe già rosso nel
          // monitoraggio e — peggio — non manderebbe mai la N52 al broker, che
          // parte solo quando questa colonna passa da null a un valore.
          zonaNonCopertaPrimaAt: null,
          // Il round è relativo al ciclo: il nuovo giro riparte da 1 e la
          // pratica non è più accettata, quindi il round di accettazione del
          // ciclo revocato non deve sopravvivergli (falserebbe la media).
          roundCorrente: 0,
          roundAccettazione: null,
          // Colonne timeline legacy: azzerate per pulizia (non più prodotte).
          round1StartedAt: null,
          round2StartedAt: null,
          round3StartedAt: null,
          escalationAt: null,
        },
      });
      if (cas.count === 0) {
        throw new Error('La pratica non è più in stato accettato/non lavorato');
      }

      await logCambioStato(tx, {
        praticaId,
        statoDa: 'ACCETTATA',
        statoA: 'IN_DISTRIBUZIONE',
        tipoEvento: STATO_EVENTO.RECIRCULATE,
        attoreUserId: adminId,
        motivo: motivoPulito,
        meta: { ciclo: nuovoCiclo, revokedSedeId },
      });

      const targa = pratica.veicoli[0]?.targa
        ? pratica.veicoli.length > 1
          ? `${pratica.veicoli[0].targa} +${pratica.veicoli.length - 1}`
          : pratica.veicoli[0].targa
        : null;

      return {
        revokedSedeId,
        revokedCompanyId,
        brokerId: pratica.brokerId,
        codicePratica: pratica.codicePratica,
        targa,
      };
    });

    // 5) primo anello sul nuovo ciclo (transazione propria + N6/evento
    // post-commit): ricontatta la zona escludendo la sede revocata. La pratica
    // è già IN_DISTRIBUZIONE; se ring1 fallisce, il cron la espande comunque.
    await avviaRound1ForPratica(praticaId).catch(() => undefined);

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
