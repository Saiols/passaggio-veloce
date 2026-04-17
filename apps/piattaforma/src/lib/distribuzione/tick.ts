import 'server-only';
import { prisma, Prisma } from '@pv/db';
import { DISTRIBUZIONE, provinceLimitrofe } from './constants';
import { computeCountdown, loadOrariPerAgenzie } from './countdown';
import { attachRating, rankCandidates } from './ranking';

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

/**
 * Ispeziona una pratica e porta avanti la macchina di stato distribuzione:
 *   1. Marca TIMEOUT le assegnazioni del round corrente con countdownFineAt scaduto
 *   2. Se tutte le assegnazioni del round non sono più PENDING → avanza round
 *   3. Se esaurisce round 3 → IN_ESCALATION
 *
 * Idempotente: richiamabile più volte senza effetti indesiderati.
 */
export async function tickPratica(praticaId: string): Promise<TickResult> {
  return prisma.$transaction(async (tx) => {
    const pratica = await tx.pratica.findUnique({
      where: { id: praticaId },
      include: {
        assegnazioni: {
          orderBy: [{ round: 'asc' }, { invioAt: 'asc' }],
        },
      },
    });

    if (!pratica) return { status: 'noop', reason: 'pratica non trovata' };

    const terminale = ['ACCETTATA', 'FIRMATA', 'ANNULLATA', 'SCADUTA'] as const;
    if ((terminale as readonly string[]).includes(pratica.stato)) {
      return { status: 'closed', finalStato: pratica.stato as 'ACCETTATA' | 'ANNULLATA' | 'FIRMATA' | 'SCADUTA' };
    }

    const currentRound = currentRoundFromStato(pratica.stato);
    if (!currentRound) {
      return { status: 'noop', reason: `stato ${pratica.stato} non gestito da tick` };
    }

    const now = new Date();
    const assegnazioniCorrenti = pratica.assegnazioni.filter(
      (a) => a.round === currentRound,
    );

    // 1) Marca TIMEOUT
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
    }

    // 2) Se c'è ancora qualche PENDING, aspettiamo
    const ancoraPending = assegnazioniCorrenti.some((a) => a.esito === 'PENDING');
    if (ancoraPending) {
      return daScadere.length > 0
        ? { status: 'timeouts-marked', count: daScadere.length }
        : { status: 'noop', reason: 'round corrente con assegnazioni pending' };
    }

    // 3) Nessuna accettata (altrimenti il flow accept avrebbe già chiuso): avanza round
    const accettata = assegnazioniCorrenti.some((a) => a.esito === 'ACCETTATA');
    if (accettata) {
      return { status: 'noop', reason: 'round già risolto con accettazione' };
    }

    // 4) Avanza round
    if (currentRound < 3) {
      const nextRound = (currentRound + 1) as 1 | 2 | 3;
      const created = await avviaRound(tx, pratica, nextRound);
      return { status: 'advanced-round', nextRound, assegnazioni: created };
    }

    // Round 3 esaurito → escalation
    await tx.pratica.update({
      where: { id: praticaId },
      data: { stato: 'IN_ESCALATION', escalationAt: now },
    });
    return { status: 'escalated' };
  });
}

/**
 * Avvia un round per una pratica: seleziona agenzie, crea PraticaAssegnazione,
 * calcola countdown, aggiorna lo stato della pratica.
 * Ritorna il numero di assegnazioni create.
 */
async function avviaRound(
  tx: Prisma.TransactionClient,
  pratica: {
    id: string;
    provincia: string | null;
    assegnazioni: { agenziaId: string }[];
  },
  round: 1 | 2 | 3,
): Promise<number> {
  const now = new Date();
  const provincia = (pratica.provincia ?? '').toUpperCase();
  const giaContattate = new Set(pratica.assegnazioni.map((a) => a.agenziaId));

  // 1) Costruisci il set di provincie target per il round
  let provincieTarget: readonly string[];
  if (round === 1 || round === 3) provincieTarget = [provincia];
  else provincieTarget = provinceLimitrofe(provincia);

  // 2) Cap agenzie per round
  const giaContattateCount = giaContattate.size;
  const maxPerRound =
    round === 3
      ? Math.max(0, DISTRIBUZIONE.N_MAX - giaContattateCount)
      : DISTRIBUZIONE.N_PER_ROUND;

  if (maxPerRound === 0 || provincieTarget.length === 0) {
    // Nessuno da contattare in questo round — escalation se siamo all'ultimo
    if (round === 3) {
      await tx.pratica.update({
        where: { id: pratica.id },
        data: { stato: 'IN_ESCALATION', escalationAt: now },
      });
    } else {
      // Skip del round e tenta il successivo ricorsivamente? Per ora marcatura semplice:
      // aggiorna lo stato al round e lascia che il prossimo tick lo faccia avanzare.
      await tx.pratica.update({
        where: { id: pratica.id },
        data: statoPerRound(round, now),
      });
    }
    return 0;
  }

  // 3) Seleziona agenzie candidate + applica ranking rating
  const raw = await tx.company.findMany({
    where: {
      type: 'AGENZIA',
      deletedAt: null,
      provincia: { in: provincieTarget as string[] },
      id: { notIn: Array.from(giaContattate) },
    },
    select: {
      id: true,
      createdAt: true,
      ragioneSociale: true,
      provincia: true,
    },
  });
  const ranked = await attachRating(tx, raw);
  const eligible = rankCandidates(ranked); // esclude sospese, ordina per rating desc
  const candidate = eligible.slice(0, maxPerRound);

  if (candidate.length === 0) {
    if (round === 3) {
      await tx.pratica.update({
        where: { id: pratica.id },
        data: { stato: 'IN_ESCALATION', escalationAt: now },
      });
    } else {
      await tx.pratica.update({
        where: { id: pratica.id },
        data: statoPerRound(round, now),
      });
    }
    return 0;
  }

  // 4) Calcola countdown per ciascuna agenzia
  const orariMap = await loadOrariPerAgenzie(
    candidate.map((c) => c.id),
    tx,
  );

  const hours = ROUND_TO_HOURS[round];

  // 5) Crea le assegnazioni
  for (const a of candidate) {
    const orari = orariMap.get(a.id) ?? { fasce: {}, chiusure: [] };
    const { inizio, fine } = computeCountdown(now, hours, orari);
    await tx.praticaAssegnazione.create({
      data: {
        praticaId: pratica.id,
        agenziaId: a.id,
        round,
        esito: 'PENDING',
        invioAt: now,
        countdownInizioAt: inizio,
        countdownFineAt: fine,
      },
    });
  }

  // 6) Aggiorna stato pratica al round corrente
  await tx.pratica.update({
    where: { id: pratica.id },
    data: statoPerRound(round, now),
  });

  return candidate.length;
}

function statoPerRound(
  round: 1 | 2 | 3,
  now: Date,
): Prisma.PraticaUncheckedUpdateInput {
  if (round === 1) return { stato: 'IN_ATTESA_ROUND_1', round1StartedAt: now };
  if (round === 2) return { stato: 'IN_ATTESA_ROUND_2', round2StartedAt: now };
  return { stato: 'IN_ATTESA_ROUND_3', round3StartedAt: now };
}

function currentRoundFromStato(stato: string): 1 | 2 | 3 | null {
  if (stato === 'IN_ATTESA_ROUND_1') return 1;
  if (stato === 'IN_ATTESA_ROUND_2') return 2;
  if (stato === 'IN_ATTESA_ROUND_3') return 3;
  return null;
}

/**
 * Avvia il round 1 per una pratica in BOZZA — usata da submitNuovaPraticaAction.
 * Scorporata per condividere la logica "apri round" tra submit e tick.
 */
export async function avviaRound1ForPratica(
  praticaId: string,
): Promise<{ assegnazioni: number; stato: string }> {
  const result = await prisma.$transaction(async (tx) => {
    const pratica = await tx.pratica.findUnique({
      where: { id: praticaId },
      include: { assegnazioni: { select: { agenziaId: true } } },
    });
    if (!pratica) throw new Error('Pratica non trovata');
    const created = await avviaRound(tx, pratica, 1);
    const updated = await tx.pratica.findUnique({
      where: { id: praticaId },
      select: { stato: true },
    });
    return { assegnazioni: created, stato: updated!.stato };
  });
  return result;
}

/**
 * Itera tutte le pratiche in distribuzione e applica tickPratica.
 * Usata da /api/jobs/distribuzione-tick (e in futuro da cron Vercel).
 */
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
