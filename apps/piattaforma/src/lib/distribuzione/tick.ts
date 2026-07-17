import 'server-only';
import { prisma, Prisma } from '@pv/db';
import { DISTRIBUZIONE } from './constants';
import { provinceLimitrofe } from './province-limitrofe';
import { computeCountdown, loadOrariPerSedi } from './countdown';
import { attachRating, rankCandidates } from './ranking';
import { checkAutoSuspendForSedi } from './auto-suspend';
import { sediDaEscludere } from './esclusioni';
import { limiteVisuraUtc } from '@/lib/visura/validita';
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
    const assegnazioniCorrenti = pratica.assegnazioni.filter((a) => a.round === currentRound);

    const daScadere = assegnazioniCorrenti.filter(
      (a) => a.esito === 'PENDING' && a.countdownFineAt && a.countdownFineAt <= now,
    );

    if (daScadere.length > 0) {
      await tx.praticaAssegnazione.updateMany({
        where: { id: { in: daScadere.map((a) => a.id) } },
        data: { esito: 'TIMEOUT', esitoAt: now },
      });
      for (const a of daScadere) {
        a.esito = 'TIMEOUT';
        a.esitoAt = now;
      }
      // A3 anti-abuso: dopo aver marcato TIMEOUT, controlla se le SEDI
      // hanno ora 5+ timeout consecutivi → auto-suspend (per sede).
      const sediToCheck = Array.from(
        new Set(daScadere.map((a) => a.sedeId).filter((x): x is string => x != null)),
      );
      await checkAutoSuspendForSedi(tx, sediToCheck);
    }

    const ancoraPending = assegnazioniCorrenti.some((a) => a.esito === 'PENDING');
    if (ancoraPending) {
      return daScadere.length > 0
        ? { result: { status: 'timeouts-marked' as const, count: daScadere.length }, jobs: emptyJobs() }
        : { result: { status: 'noop' as const, reason: 'assegnazioni pending' }, jobs: emptyJobs() };
    }

    const accettata = assegnazioniCorrenti.some((a) => a.esito === 'ACCETTATA');
    if (accettata) {
      return { result: { status: 'noop' as const, reason: 'round già risolto con accettazione' }, jobs: emptyJobs() };
    }

    if (currentRound < 3) {
      const nextRound = (currentRound + 1) as 1 | 2 | 3;
      const { count, newAssegnazioniIds, escalated } = await avviaRound(tx, pratica, nextRound);
      await logCambioStato(tx, {
        praticaId,
        statoDa: pratica.stato,
        statoA: escalated ? 'IN_ESCALATION' : statoNomePerRound(nextRound),
        tipoEvento: escalated ? STATO_EVENTO.ESCALATION : STATO_EVENTO.ROUND_ADVANCE,
        meta: { round: nextRound, ciclo: pratica.distribuzioneCiclo },
      });
      return {
        result: { status: 'advanced-round' as const, nextRound, assegnazioni: count },
        jobs: {
          newAssegnazioniIds,
          escalationPraticaId: escalated ? praticaId : null,
        },
      };
    }

    // Round 3 esaurito → escalation
    await tx.pratica.update({
      where: { id: praticaId },
      data: { stato: 'IN_ESCALATION', escalationAt: now },
    });
    await logCambioStato(tx, {
      praticaId,
      statoDa: pratica.stato,
      statoA: 'IN_ESCALATION',
      tipoEvento: STATO_EVENTO.ESCALATION,
      meta: { round: currentRound, ciclo: pratica.distribuzioneCiclo },
    });
    return {
      result: { status: 'escalated' as const },
      jobs: { newAssegnazioniIds: [], escalationPraticaId: praticaId },
    };
  });

  await processPostCommitJobs(jobs);
  return result;
}

export async function avviaRound(
  tx: Prisma.TransactionClient,
  pratica: {
    id: string;
    provincia: string | null;
    distribuzioneCiclo: number;
    assegnazioni: { sedeId: string | null; ciclo: number; esito: string }[];
  },
  round: 1 | 2 | 3,
): Promise<{ count: number; newAssegnazioniIds: string[]; escalated: boolean }> {
  const now = new Date();
  const provincia = (pratica.provincia ?? '').toUpperCase();
  const sediContattate = new Set(sediDaEscludere(pratica));

  let provincieTarget: readonly string[];
  if (round === 1 || round === 3) provincieTarget = [provincia];
  else provincieTarget = provinceLimitrofe(provincia);

  const maxPerRound =
    round === 3
      ? Math.max(0, DISTRIBUZIONE.N_MAX - sediContattate.size)
      : DISTRIBUZIONE.N_PER_ROUND;

  if (maxPerRound === 0 || provincieTarget.length === 0) {
    return handleNoCandidates(tx, pratica.id, round, now);
  }

  // Multi-sede: i candidati sono SEDI agenzia (non Company). Ogni sede
  // compete in modo indipendente; `sediContattate` esclude le sedi già
  // contattate (anche più sedi della stessa madre restano candidate).
  const rawSedi = await tx.sede.findMany({
    where: {
      type: 'AGENZIA',
      deletedAt: null,
      suspendedAt: null,
      provincia: { in: provincieTarget as string[] },
      id: { notIn: Array.from(sediContattate) },
      company: {
        deletedAt: null,
        suspendedAt: null,
        bloccoPagamentoAt: null,
        // Ciclo di vita visura: un'agenzia con visura scaduta non riceve nuove
        // pratiche. La visura sta sulla MADRE → escludendo la madre escono tutte
        // le sue sedi, che è il comportamento voluto (multi-sede, P.IVA unica).
        // `null` = ESENTE, deve restare idonea: senza questo ramo escluderemmo
        // tutte le aziende senza data (oggi 9 agenzie su 10, account demo/seed).
        OR: [
          { visuraCameraleData: null },
          { visuraCameraleData: { gt: limiteVisuraUtc(now) } },
        ],
      },
    },
    select: { id: true, createdAt: true, nome: true, provincia: true, companyId: true },
  });
  const raw = rawSedi.map((s) => ({
    id: s.id,
    companyId: s.companyId,
    createdAt: s.createdAt,
    ragioneSociale: s.nome,
    provincia: s.provincia,
  }));
  const rankedCandidates = await attachRating(tx, raw);
  const eligible = rankCandidates(rankedCandidates);

  // Tutte le sedi idonee competono in modo indipendente (prima che accetta vince).
  const candidate = eligible.slice(0, maxPerRound);

  if (candidate.length === 0) {
    return handleNoCandidates(tx, pratica.id, round, now);
  }

  const orariMap = await loadOrariPerSedi(
    candidate.map((c) => c.id),
    tx,
  );
  const hours = ROUND_TO_HOURS[round];
  const newIds: string[] = [];

  for (const a of candidate) {
    const orari = orariMap.get(a.id) ?? { fasce: {}, chiusure: [] };
    const { inizio, fine } = computeCountdown(now, hours, orari);
    const created = await tx.praticaAssegnazione.create({
      data: {
        praticaId: pratica.id,
        agenziaId: a.companyId, // madre (colonna legacy, NOT NULL)
        sedeId: a.id, // sede fisica assegnataria
        round,
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
    data: statoPerRound(round, now),
  });

  return { count: candidate.length, newAssegnazioniIds: newIds, escalated: false };
}

async function handleNoCandidates(
  tx: Prisma.TransactionClient,
  praticaId: string,
  round: 1 | 2 | 3,
  now: Date,
): Promise<{ count: number; newAssegnazioniIds: string[]; escalated: boolean }> {
  if (round === 3) {
    await tx.pratica.update({
      where: { id: praticaId },
      data: { stato: 'IN_ESCALATION', escalationAt: now },
    });
    return { count: 0, newAssegnazioniIds: [], escalated: true };
  }
  await tx.pratica.update({
    where: { id: praticaId },
    data: statoPerRound(round, now),
  });
  return { count: 0, newAssegnazioniIds: [], escalated: false };
}

function statoPerRound(
  round: 1 | 2 | 3,
  now: Date,
): Prisma.PraticaUncheckedUpdateInput {
  if (round === 1) return { stato: 'IN_ATTESA_ROUND_1', round1StartedAt: now };
  if (round === 2) return { stato: 'IN_ATTESA_ROUND_2', round2StartedAt: now };
  return { stato: 'IN_ATTESA_ROUND_3', round3StartedAt: now };
}

function statoNomePerRound(round: 1 | 2 | 3): 'IN_ATTESA_ROUND_1' | 'IN_ATTESA_ROUND_2' | 'IN_ATTESA_ROUND_3' {
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
      tipoEvento: updated!.stato === 'IN_ESCALATION' ? STATO_EVENTO.ESCALATION : STATO_EVENTO.SUBMIT,
      meta: { round: 1, ciclo: pratica.distribuzioneCiclo },
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
