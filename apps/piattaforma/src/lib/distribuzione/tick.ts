import 'server-only';
import { prisma, Prisma } from '@pv/db';
import { DISTRIBUZIONE } from './constants';
import { computeCountdown, loadOrariPerSedi } from './countdown';
import { checkAutoSuspendForSedi } from './auto-suspend';
import { sediDaEscludere } from './esclusioni';
import { limiteVisuraUtc } from '@/lib/visura/validita';
import { distanceKm } from '@/lib/geo/coords';
import {
  getAdminEmails,
  sendNotification,
  sendNotifications,
  type N6AgenziaNuovaPayload,
} from '@/lib/notifiche';
import { emitEventiPratica, emitEventoPratica } from '@/lib/eventi/emit';
import { eventoNuovaPratica, eventoPraticaEscalation } from '@/lib/eventi/pratica-eventi';
import { destinatariBroker, destinatariSedeAgenzia } from '@/lib/notifiche/pratica';
import { logCambioStato, STATO_EVENTO } from '@/lib/pratiche/stato-log';

const ROUND_TO_HOURS: Record<1 | 2 | 3, number> = {
  1: DISTRIBUZIONE.T1_HOURS,
  2: DISTRIBUZIONE.T2_HOURS,
  3: DISTRIBUZIONE.T3_HOURS,
};

export type TickResult =
  | { status: 'noop'; reason: string }
  | { status: 'timeouts-marked'; count: number }
  | { status: 'advanced-round'; nextRound: 1 | 2 | 3; assegnazioni: number }
  | { status: 'escalated' }
  | { status: 'closed'; finalStato: 'ACCETTATA' | 'ANNULLATA' | 'FIRMATA' | 'SCADUTA' };

/** Side-effect jobs accumulati dentro la transazione per esecuzione post-commit. */
type PostCommitJobs = {
  newAssegnazioniIds: string[]; // emette N6
  escalationPraticaId: string | null; // emette N10 + N11
};

/** Escalation: mette in TIMEOUT TUTTE le PENDING della pratica (pool cumulativo →
 *  dopo l'escalation nessuno deve poter accettare), poi IN_ESCALATION. Scatta anche
 *  l'anti-abuso sui no-show. */
async function escalatePratica(tx: Prisma.TransactionClient, praticaId: string, now: Date): Promise<void> {
  const pending = await tx.praticaAssegnazione.findMany({
    where: { praticaId, esito: 'PENDING' },
    select: { id: true, sedeId: true },
  });
  if (pending.length > 0) {
    await tx.praticaAssegnazione.updateMany({
      where: { id: { in: pending.map((a) => a.id) } },
      data: { esito: 'TIMEOUT', esitoAt: now },
    });
    const sedi = Array.from(new Set(pending.map((a) => a.sedeId).filter((x): x is string => x != null)));
    await checkAutoSuspendForSedi(tx, sedi);
  }
  await tx.pratica.update({ where: { id: praticaId }, data: { stato: 'IN_ESCALATION', escalationAt: now } });
}

/** Ri-arma le PENDING SCADUTE (le nuove appena create hanno già finestra fresca)
 *  con una nuova finestra di `hours` ore lavorative, per gli orari di ciascuna sede
 *  → scadenza allineata che avanza. NON tocca l'esito (restano PENDING). */
async function riarmaPendingScadute(
  tx: Prisma.TransactionClient,
  praticaId: string,
  now: Date,
  hours: number,
): Promise<void> {
  const scadute = await tx.praticaAssegnazione.findMany({
    where: { praticaId, esito: 'PENDING', countdownFineAt: { lte: now } },
    select: { id: true, sedeId: true },
  });
  if (scadute.length === 0) return;
  const orariMap = await loadOrariPerSedi(
    scadute.map((a) => a.sedeId).filter((x): x is string => x != null),
    tx,
  );
  for (const a of scadute) {
    const orari = a.sedeId ? (orariMap.get(a.sedeId) ?? { fasce: {}, chiusure: [] }) : { fasce: {}, chiusure: [] };
    const { inizio, fine } = computeCountdown(now, hours, orari);
    await tx.praticaAssegnazione.update({
      where: { id: a.id },
      data: { countdownInizioAt: inizio, countdownFineAt: fine },
    });
  }
}

export async function tickPratica(praticaId: string): Promise<TickResult> {
  const { result, jobs } = await prisma.$transaction(async (tx) => {
    const pratica = await tx.pratica.findUnique({
      where: { id: praticaId },
      include: {
        assegnazioni: { orderBy: [{ round: 'asc' }, { invioAt: 'asc' }] },
      },
    });

    if (!pratica) {
      return { result: { status: 'noop' as const, reason: 'pratica non trovata' }, jobs: emptyJobs() };
    }

    const terminale = ['ACCETTATA', 'FIRMATA', 'ANNULLATA', 'SCADUTA'] as const;
    if ((terminale as readonly string[]).includes(pratica.stato)) {
      return {
        result: { status: 'closed' as const, finalStato: pratica.stato as 'ACCETTATA' | 'ANNULLATA' | 'FIRMATA' | 'SCADUTA' },
        jobs: emptyJobs(),
      };
    }

    const currentRound = currentRoundFromStato(pratica.stato);
    if (!currentRound) {
      return { result: { status: 'noop' as const, reason: `stato ${pratica.stato} non gestito` }, jobs: emptyJobs() };
    }

    const now = new Date();

    // Pool cumulativo: TUTTE le PENDING (qualunque round), non solo il round corrente.
    const pending = pratica.assegnazioni.filter((a) => a.esito === 'PENDING');
    const accettata = pratica.assegnazioni.some((a) => a.esito === 'ACCETTATA');
    if (accettata) {
      return { result: { status: 'noop' as const, reason: 'già accettata' }, jobs: emptyJobs() };
    }

    // Se almeno una PENDING è ancora nella sua finestra → attesa.
    const ancoraAperta = pending.some((a) => a.countdownFineAt != null && a.countdownFineAt > now);
    if (ancoraAperta) {
      return { result: { status: 'noop' as const, reason: 'finestra aperta' }, jobs: emptyJobs() };
    }

    // Tutte le PENDING scadute (o nessuna) e nessuno ha accettato.
    if (currentRound < 3) {
      const nextRound = (currentRound + 1) as 1 | 2 | 3;
      const { count, newAssegnazioniIds, escalated, round: reached } = await avviaRound(tx, pratica, nextRound);
      if (!escalated) {
        // Ri-arma le PENDING scadute (le nuove hanno già finestra fresca) con la
        // finestra del round raggiunto → scadenza allineata che avanza.
        await riarmaPendingScadute(tx, praticaId, now, ROUND_TO_HOURS[reached]);
      }
      await logCambioStato(tx, {
        praticaId,
        statoDa: pratica.stato,
        statoA: escalated ? 'IN_ESCALATION' : statoNomePerRound(reached),
        tipoEvento: escalated ? STATO_EVENTO.ESCALATION : STATO_EVENTO.ROUND_ADVANCE,
        meta: { round: reached, ciclo: pratica.distribuzioneCiclo },
      });
      return {
        result: escalated
          ? { status: 'escalated' as const }
          : { status: 'advanced-round' as const, nextRound: reached, assegnazioni: count },
        jobs: { newAssegnazioniIds, escalationPraticaId: escalated ? praticaId : null },
      };
    }

    // Round 3, tutte scadute, nessuno ha accettato → escalation (TIMEOUT a tutte).
    await escalatePratica(tx, praticaId, now);
    await logCambioStato(tx, {
      praticaId,
      statoDa: pratica.stato,
      statoA: 'IN_ESCALATION',
      tipoEvento: STATO_EVENTO.ESCALATION,
      meta: { round: currentRound, ciclo: pratica.distribuzioneCiclo },
    });
    return { result: { status: 'escalated' as const }, jobs: { newAssegnazioniIds: [], escalationPraticaId: praticaId } };
  });

  await processPostCommitJobs(jobs);
  return result;
}

export async function avviaRound(
  tx: Prisma.TransactionClient,
  pratica: {
    id: string;
    lat: number | null;
    lng: number | null;
    distribuzioneCiclo: number;
    assegnazioni: { sedeId: string | null; ciclo: number; esito: string }[];
  },
  round: 1 | 2 | 3,
): Promise<{ count: number; newAssegnazioniIds: string[]; escalated: boolean; round: 1 | 2 | 3 }> {
  const now = new Date();
  const sediContattate = sediDaEscludere(pratica);

  // Senza coordinate della pratica non possiamo calcolare distanze → escalation.
  // (Non dovrebbe accadere: il submit le rende obbligatorie; guardia difensiva.)
  if (pratica.lat == null || pratica.lng == null) {
    await escalatePratica(tx, pratica.id, now);
    return { count: 0, newAssegnazioniIds: [], escalated: true, round: 3 };
  }
  const origine = { lat: pratica.lat, lng: pratica.lng };

  // Sedi agenzia idonee CON coordinate, non ancora contattate nel ciclo.
  const sediIdonee = await tx.sede.findMany({
    where: {
      type: 'AGENZIA',
      deletedAt: null,
      suspendedAt: null,
      lat: { not: null },
      lng: { not: null },
      id: { notIn: sediContattate },
      company: {
        deletedAt: null,
        suspendedAt: null,
        bloccoPagamentoAt: null,
        OR: [
          { visuraCameraleData: null },
          { visuraCameraleData: { gt: limiteVisuraUtc(now) } },
        ],
      },
    },
    select: { id: true, lat: true, lng: true, companyId: true },
  });

  // Cascade: dal round richiesto fino al 3, il primo anello non vuoto vince
  // (anello incrementale: le sedi dei round precedenti sono già escluse).
  for (let r = round; r <= 3; r++) {
    const raggio = DISTRIBUZIONE.RAGGI_KM[r - 1];
    const inRing = sediIdonee.filter(
      (s) =>
        s.lat != null &&
        s.lng != null &&
        distanceKm(origine, { lat: s.lat, lng: s.lng }) <= raggio,
    );
    if (inRing.length === 0) continue;

    const orariMap = await loadOrariPerSedi(inRing.map((s) => s.id), tx);
    const hours = ROUND_TO_HOURS[r as 1 | 2 | 3];
    const newIds: string[] = [];
    for (const s of inRing) {
      const orari = orariMap.get(s.id) ?? { fasce: {}, chiusure: [] };
      const { inizio, fine } = computeCountdown(now, hours, orari);
      const created = await tx.praticaAssegnazione.create({
        data: {
          praticaId: pratica.id,
          agenziaId: s.companyId, // madre (colonna legacy, NOT NULL)
          sedeId: s.id,
          round: r,
          ciclo: pratica.distribuzioneCiclo,
          esito: 'PENDING',
          invioAt: now,
          countdownInizioAt: inizio,
          countdownFineAt: fine,
        },
      });
      newIds.push(created.id);
    }
    await tx.pratica.update({
      where: { id: pratica.id },
      data: statoPerRound(r as 1 | 2 | 3, now),
    });
    return { count: inRing.length, newAssegnazioniIds: newIds, escalated: false, round: r as 1 | 2 | 3 };
  }

  // Nessuna sede fino a 1 km → escalation.
  await escalatePratica(tx, pratica.id, now);
  return { count: 0, newAssegnazioniIds: [], escalated: true, round: 3 };
}

function statoPerRound(
  round: 1 | 2 | 3,
  now: Date,
): Prisma.PraticaUncheckedUpdateInput {
  if (round === 1) return { stato: 'IN_ATTESA_ROUND_1', round1StartedAt: now };
  if (round === 2) return { stato: 'IN_ATTESA_ROUND_2', round2StartedAt: now };
  return { stato: 'IN_ATTESA_ROUND_3', round3StartedAt: now };
}

export function statoNomePerRound(round: 1 | 2 | 3): 'IN_ATTESA_ROUND_1' | 'IN_ATTESA_ROUND_2' | 'IN_ATTESA_ROUND_3' {
  return round === 1 ? 'IN_ATTESA_ROUND_1' : round === 2 ? 'IN_ATTESA_ROUND_2' : 'IN_ATTESA_ROUND_3';
}

function currentRoundFromStato(stato: string): 1 | 2 | 3 | null {
  if (stato === 'IN_ATTESA_ROUND_1') return 1;
  if (stato === 'IN_ATTESA_ROUND_2') return 2;
  if (stato === 'IN_ATTESA_ROUND_3') return 3;
  return null;
}

function emptyJobs(): PostCommitJobs {
  return { newAssegnazioniIds: [], escalationPraticaId: null };
}

export async function processPostCommitJobs(jobs: PostCommitJobs): Promise<void> {
  if (jobs.newAssegnazioniIds.length > 0) {
    await emitN6ForAssegnazioni(jobs.newAssegnazioniIds);
  }
  if (jobs.escalationPraticaId) {
    await emitEscalationNotifications(jobs.escalationPraticaId);
  }
}

async function emitN6ForAssegnazioni(assegnazioneIds: string[]): Promise<void> {
  const assegnazioni = await prisma.praticaAssegnazione.findMany({
    where: { id: { in: assegnazioneIds } },
    include: {
      agenzia: {
        select: {
          id: true,
          ragioneSociale: true,
          email: true,
          // Destinatario = email di registrazione dell'admin azienda.
          users: {
            where: { role: 'ADMIN_AZIENDA', status: 'ACTIVE' },
            select: { id: true, email: true },
            take: 1,
          },
        },
      },
      pratica: {
        select: {
          codicePratica: true,
          veicoli: { orderBy: { ordine: 'asc' }, select: { targa: true } },
          comune: true,
          provincia: true,
          feeAgenziaCent: true,
        },
      },
    },
  });

  const batchTotal = assegnazioni.length;

  // L'assegnataria è la SEDE: la N6 va a chi lavora in quella filiale, non
  // all'admin della madre. Nessun preferito: nessuno l'ha ancora presa in carico.
  // Le righe legacy senza sedeId ricadono sul comportamento storico.
  const inputs = (
    await Promise.all(
      assegnazioni.map(async (a) => {
        const destinatari = a.sedeId
          ? await destinatariSedeAgenzia(a.sedeId)
          : [
              {
                email: a.agenzia.users[0]?.email ?? a.agenzia.email,
                userId: a.agenzia.users[0]?.id ?? null,
                nome: a.agenzia.ragioneSociale,
              },
            ];

        return destinatari.map((d) => ({
          tipo: 'N6_AGENZIA_NUOVA_PRATICA' as const,
          target: { email: d.email, userId: d.userId, companyId: a.agenzia.id },
          payload: {
            codicePratica: a.pratica.codicePratica ?? '—',
            targa:
              a.pratica.veicoli[0]?.targa
                ? a.pratica.veicoli.length > 1
                  ? `${a.pratica.veicoli[0].targa} +${a.pratica.veicoli.length - 1}`
                  : a.pratica.veicoli[0].targa
                : null,
            comune: a.pratica.comune,
            provincia: a.pratica.provincia,
            feeCent: a.pratica.feeAgenziaCent,
            round: a.round,
            altreAgenzie: Math.max(0, batchTotal - 1),
            countdownFineAt: a.countdownFineAt,
            nomeAgenzia: a.agenzia.ragioneSociale,
          } satisfies N6AgenziaNuovaPayload,
        }));
      }),
    )
  ).flat();

  await sendNotifications(inputs);

  // Eventi in-app (modale "nuova pratica") per ogni agenzia selezionata.
  await emitEventiPratica(
    prisma,
    assegnazioni
      .filter((a) => a.pratica.codicePratica)
      .map((a) =>
        eventoNuovaPratica({
          praticaId: a.praticaId,
          agenziaId: a.agenzia.id,
          sedeId: a.sedeId,
          codicePratica: a.pratica.codicePratica!,
        }),
      ),
  ).catch(() => undefined);
}

async function emitEscalationNotifications(praticaId: string): Promise<void> {
  const pratica = await prisma.pratica.findUnique({
    where: { id: praticaId },
    include: {
      broker: {
        include: {
          users: { where: { role: 'ADMIN_AZIENDA', status: 'ACTIVE', deletedAt: null }, select: { email: true, nome: true, id: true }, take: 1 },
        },
      },
      assegnazioni: { select: { id: true } },
      veicoli: { orderBy: { ordine: 'asc' }, select: { targa: true } },
    },
  });
  if (!pratica) return;

  const tentativi = pratica.assegnazioni.length;
  const targaPratica =
    pratica.veicoli[0]?.targa
      ? pratica.veicoli.length > 1
        ? `${pratica.veicoli[0].targa} +${pratica.veicoli.length - 1}`
        : pratica.veicoli[0].targa
      : null;
  const admins = await getAdminEmails();

  const targets = admins.map((a) => ({
    tipo: 'N10_ADMIN_ESCALATION' as const,
    target: { email: a.email, userId: a.userId, companyId: null },
    payload: {
      codicePratica: pratica.codicePratica ?? '—',
      targa: targaPratica,
      comune: pratica.comune,
      provincia: pratica.provincia,
      tentativi,
      brokerRagioneSociale: pratica.broker.ragioneSociale,
      brokerEmail: pratica.broker.email,
      brokerTelefono: pratica.broker.telefono,
    },
  }));

  await sendNotifications(targets);

  // Recapito: chi ha creato la pratica; se non è più raggiungibile la catena
  // scende alla sua sede, poi all'admin azienda. Vedi lib/notifiche/pratica.ts.
  const destinatari = await destinatariBroker(praticaId);
  for (const d of destinatari) {
    // Un destinatario che fallisce non deve azzerare l'invio agli altri.
    await sendNotification({
      tipo: 'N11_BROKER_ESCALATION',
      target: { email: d.email, userId: d.userId, companyId: pratica.broker.id },
      payload: {
        codicePratica: pratica.codicePratica ?? '—',
        targa: targaPratica,
        nomeBroker: d.nome,
      },
    }).catch(() => undefined);
  }

  // Evento in-app (modale) per il broker: nessuna agenzia disponibile.
  if (pratica.codicePratica) {
    await emitEventoPratica(
      prisma,
      eventoPraticaEscalation({
        praticaId,
        brokerId: pratica.broker.id,
        sedeId: pratica.brokerSedeId,
        codicePratica: pratica.codicePratica,
      }),
    ).catch(() => undefined);
  }
}

/**
 * Avvia il round 1 per una pratica appena creata.
 */
export async function avviaRound1ForPratica(praticaId: string): Promise<{
  assegnazioni: number;
  stato: string;
  newAssegnazioniIds: string[];
  escalated: boolean;
}> {
  const result = await prisma.$transaction(async (tx) => {
    const pratica = await tx.pratica.findUnique({
      where: { id: praticaId },
      include: { assegnazioni: { select: { sedeId: true, ciclo: true, esito: true } } },
    });
    if (!pratica) throw new Error('Pratica non trovata');
    const r = await avviaRound(tx, pratica, 1);
    const updated = await tx.pratica.findUnique({
      where: { id: praticaId },
      select: { stato: true },
    });
    await logCambioStato(tx, {
      praticaId,
      statoDa: pratica.stato,
      statoA: updated!.stato,
      tipoEvento: r.escalated ? STATO_EVENTO.ESCALATION : STATO_EVENTO.SUBMIT,
      meta: { round: r.round, ciclo: pratica.distribuzioneCiclo },
    });
    return {
      assegnazioni: r.count,
      stato: updated!.stato,
      newAssegnazioniIds: r.newAssegnazioniIds,
      escalated: r.escalated,
    };
  });

  // Post-commit: notifiche alle agenzie + escalation se nessuno
  await processPostCommitJobs({
    newAssegnazioniIds: result.newAssegnazioniIds,
    escalationPraticaId: result.escalated ? praticaId : null,
  });

  return result;
}

export async function tickAllPraticheInDistribuzione(): Promise<{
  scanned: number;
  timeoutsMarked: number;
  roundsAdvanced: number;
  escalated: number;
}> {
  const pratiche = await prisma.pratica.findMany({
    where: {
      stato: { in: ['IN_ATTESA_ROUND_1', 'IN_ATTESA_ROUND_2', 'IN_ATTESA_ROUND_3'] },
      deletedAt: null,
    },
    select: { id: true },
  });

  const counters = { scanned: 0, timeoutsMarked: 0, roundsAdvanced: 0, escalated: 0 };

  for (const p of pratiche) {
    counters.scanned += 1;
    const r = await tickPratica(p.id);
    if (r.status === 'timeouts-marked') counters.timeoutsMarked += r.count;
    if (r.status === 'advanced-round') counters.roundsAdvanced += 1;
    if (r.status === 'escalated') counters.escalated += 1;
  }

  return counters;
}
