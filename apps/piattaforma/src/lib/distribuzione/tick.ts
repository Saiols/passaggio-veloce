import 'server-only';
import { prisma, Prisma } from '@pv/db';
import { getDistribuzioneConfig } from './config';
import { isOrarioLavorativo } from './orario-piattaforma';
import { prossimoAnello, type SedeConDistanza } from './anelli';
import { sediDaEscludere } from './esclusioni';
import { limiteVisuraUtc } from '@/lib/visura/validita';
import { distanceKm } from '@/lib/geo/coords';
import { roadDistancesM, type LatLng } from '@/lib/geo/road-distance';
import {
  sendNotification,
  sendNotifications,
  type N6AgenziaNuovaPayload,
} from '@/lib/notifiche';
import { emitEventiPratica, emitEventoPratica } from '@/lib/eventi/emit';
import { eventoNuovaPratica, eventoPraticaEscalation } from '@/lib/eventi/pratica-eventi';
import { destinatariBroker, destinatariSedeAgenzia } from '@/lib/notifiche/pratica';
import { logCambioStato, STATO_EVENTO } from '@/lib/pratiche/stato-log';

export type TickResult =
  | { status: 'noop'; reason: string }
  | { status: 'notified'; assegnazioni: number; raggioM: number }
  | { status: 'zona-non-coperta' }
  | { status: 'closed'; finalStato: 'ACCETTATA' | 'ANNULLATA' | 'FIRMATA' | 'SCADUTA' };

const STATI_TERMINALI = ['ACCETTATA', 'FIRMATA', 'ANNULLATA', 'SCADUTA'] as const;

/** Side-effect jobs accumulati dentro la transazione per esecuzione post-commit. */
type PostCommitJobs = {
  newAssegnazioniIds: string[]; // emette N6 + evento modale "nuova pratica"
  zonaNonCopertaPraticaId: string | null; // emette N52 broker + evento modale
};

function emptyJobs(): PostCommitJobs {
  return { newAssegnazioniIds: [], zonaNonCopertaPraticaId: null };
}

function noop(reason: string): TickResult {
  return { status: 'noop', reason };
}

/** Forma minima della pratica necessaria a costruire i candidati. */
type PraticaCandidati = {
  id: string;
  distribuzioneCiclo: number;
  assegnazioni: { sedeId: string | null; ciclo: number; esito: string }[];
};

/**
 * Sedi agenzia candidate con distanza STRADALE (m) entro `sogliaM`, escluse
 * quelle già contattate nel ciclo / revocate permanentemente.
 *
 * Query `where` invariata rispetto al motore precedente (AGENZIA, non
 * deleted/suspended, coord presenti, company non bloccata e con visura valida,
 * `id notIn sediDaEscludere`). Poi il prefiltro Haversine (`distanceKm ≤
 * sogliaM`, superset garantito perché la strada è sempre ≥ della linea d'aria)
 * limita le chiamate al provider stradale; `roadDistancesM` (cache + Google +
 * fail-open Haversine) dà i metri reali; si tengono solo le sedi con stradale
 * ≤ sogliaM.
 */
async function candidatiEntro(
  tx: Prisma.TransactionClient,
  pratica: PraticaCandidati,
  origine: LatLng,
  sogliaM: number,
  now: Date,
): Promise<SedeConDistanza[]> {
  const sediContattate = sediDaEscludere(pratica);

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

  // Prefiltro Haversine: condizione necessaria (strada ≥ linea d'aria) → superset.
  const sogliaKm = sogliaM / 1000;
  const prefiltrate = sediIdonee.filter(
    (s) =>
      s.lat != null &&
      s.lng != null &&
      distanceKm(origine, { lat: s.lat, lng: s.lng }) <= sogliaKm,
  );
  if (prefiltrate.length === 0) return [];

  const distanze = await roadDistancesM(
    pratica.id,
    origine,
    prefiltrate.map((s) => ({ sedeId: s.id, coord: { lat: s.lat!, lng: s.lng! } })),
    tx,
  );

  const out: SedeConDistanza[] = [];
  for (const s of prefiltrate) {
    const d = distanze.get(s.id);
    if (d != null && d <= sogliaM) {
      out.push({ sedeId: s.id, companyId: s.companyId, distanzaM: d });
    }
  }
  return out;
}

/** Crea le PraticaAssegnazione PENDING per le sedi dell'anello raggiunto. */
async function creaAssegnazioni(
  tx: Prisma.TransactionClient,
  praticaId: string,
  ciclo: number,
  raggioM: number,
  sedi: SedeConDistanza[],
  now: Date,
): Promise<string[]> {
  const ids: string[] = [];
  for (const s of sedi) {
    const created = await tx.praticaAssegnazione.create({
      data: {
        praticaId,
        agenziaId: s.companyId, // madre (colonna legacy, NOT NULL)
        sedeId: s.sedeId,
        // `round` resta NOT NULL nello schema: la v2 non ha più round, il
        // raggio d'ingresso vive in `raggioMetri`. Valore fisso 1 per le righe v2.
        round: 1,
        ciclo,
        raggioMetri: raggioM,
        esito: 'PENDING',
        invioAt: now,
      },
    });
    ids.push(created.id);
  }
  return ids;
}

/**
 * Tick di espansione per UNA pratica in distribuzione.
 *
 * Guardie → gate orario → gate 10 min → costruzione candidati (stradale ≤
 * raggioMaxM) → `prossimoAnello`:
 *  - `notifica`: crea le assegnazioni dell'anello raggiunto, avanza
 *    `raggioCorrenteM`, marca `ultimaEspansioneAt = now`, coda N6.
 *  - `zona-non-coperta`: marca `zonaNonCopertaAt = now` (le PENDING restano
 *    accettabili), coda N52 al broker.
 */
export async function tickPratica(praticaId: string): Promise<TickResult> {
  const { result, jobs } = await prisma.$transaction(async (tx) => {
    const pratica = await tx.pratica.findUnique({
      where: { id: praticaId },
      include: { assegnazioni: { select: { sedeId: true, ciclo: true, esito: true } } },
    });
    if (!pratica) {
      return { result: noop('pratica non trovata'), jobs: emptyJobs() };
    }

    const cfg = await getDistribuzioneConfig(tx);
    const now = new Date();

    // Terminale (incl. ACCETTATA) → uscita dalla distribuzione.
    if ((STATI_TERMINALI as readonly string[]).includes(pratica.stato)) {
      return {
        result: {
          status: 'closed' as const,
          finalStato: pratica.stato as 'ACCETTATA' | 'ANNULLATA' | 'FIRMATA' | 'SCADUTA',
        },
        jobs: emptyJobs(),
      };
    }

    // Stato non gestito da questo motore (es. BOZZA, PROCESSATA, IN_ATTESA_ROUND_* legacy).
    if (pratica.stato !== 'IN_DISTRIBUZIONE') {
      return { result: noop(`stato ${pratica.stato} non gestito`), jobs: emptyJobs() };
    }

    // Già dichiarata zona non coperta → l'espansione è ferma (accettazione tardiva
    // resta possibile finché una PENDING è in giro, ma non tocca a questo motore).
    if (pratica.zonaNonCopertaAt) {
      return { result: noop('zona non coperta'), jobs: emptyJobs() };
    }

    // Coordinate mancanti → non calcolabile (guardia difensiva: il submit le rende
    // obbligatorie). Zona non coperta immediata, senza crash.
    if (pratica.lat == null || pratica.lng == null) {
      await tx.pratica.update({
        where: { id: praticaId },
        data: { raggioCorrenteM: cfg.raggioMaxM, zonaNonCopertaAt: now },
      });
      await logCambioStato(tx, {
        praticaId,
        statoDa: 'IN_DISTRIBUZIONE',
        statoA: 'IN_DISTRIBUZIONE',
        tipoEvento: STATO_EVENTO.ESCALATION,
        meta: { zonaNonCoperta: true, motivo: 'coordinate-mancanti', ciclo: pratica.distribuzioneCiclo },
      });
      return {
        result: { status: 'zona-non-coperta' as const },
        jobs: { newAssegnazioniIds: [], zonaNonCopertaPraticaId: praticaId },
      };
    }

    // Fuori orario lavorativo piattaforma → pausa (nessuno stato cambia).
    if (!isOrarioLavorativo(now, cfg)) {
      return { result: noop('fuori orario'), jobs: emptyJobs() };
    }

    // Gate 10 min: se l'ultima notifica è troppo recente, attendi il prossimo tick.
    if (
      pratica.ultimaEspansioneAt &&
      (now.getTime() - pratica.ultimaEspansioneAt.getTime()) / 60000 < cfg.intervalloMin
    ) {
      return { result: noop('finestra 10min'), jobs: emptyJobs() };
    }

    const origine: LatLng = { lat: pratica.lat, lng: pratica.lng };
    const candidati = await candidatiEntro(tx, pratica, origine, cfg.raggioMaxM, now);
    const res = prossimoAnello(candidati, pratica.raggioCorrenteM ?? cfg.raggioStartM, cfg);

    if (res.tipo === 'notifica') {
      const newIds = await creaAssegnazioni(
        tx,
        praticaId,
        pratica.distribuzioneCiclo,
        res.raggioRaggiuntoM,
        res.sedi,
        now,
      );
      await tx.pratica.update({
        where: { id: praticaId },
        data: { raggioCorrenteM: res.raggioRaggiuntoM, ultimaEspansioneAt: now },
      });
      await logCambioStato(tx, {
        praticaId,
        statoDa: 'IN_DISTRIBUZIONE',
        statoA: 'IN_DISTRIBUZIONE',
        tipoEvento: STATO_EVENTO.ROUND_ADVANCE,
        meta: { raggioM: res.raggioRaggiuntoM, ciclo: pratica.distribuzioneCiclo },
      });
      return {
        result: { status: 'notified' as const, assegnazioni: newIds.length, raggioM: res.raggioRaggiuntoM },
        jobs: { newAssegnazioniIds: newIds, zonaNonCopertaPraticaId: null },
      };
    }

    // zona-non-coperta: nessuna sede entro il raggio massimo.
    await tx.pratica.update({
      where: { id: praticaId },
      data: { raggioCorrenteM: cfg.raggioMaxM, zonaNonCopertaAt: now },
    });
    await logCambioStato(tx, {
      praticaId,
      statoDa: 'IN_DISTRIBUZIONE',
      statoA: 'IN_DISTRIBUZIONE',
      tipoEvento: STATO_EVENTO.ESCALATION,
      meta: { zonaNonCoperta: true, raggioM: cfg.raggioMaxM, ciclo: pratica.distribuzioneCiclo },
    });
    return {
      result: { status: 'zona-non-coperta' as const },
      jobs: { newAssegnazioniIds: [], zonaNonCopertaPraticaId: praticaId },
    };
  });

  await processPostCommitJobs(jobs);
  return result;
}

/**
 * Primo anello al submit (o al ricircolo dopo revoca): porta la pratica in
 * `IN_DISTRIBUZIONE`, `raggioCorrenteM = raggioStartM`, e contatta le sedi entro
 * il raggio iniziale. **Ignora l'orario lavorativo** (il primo anello parte a
 * qualsiasi ora). Se nessuna sede è in zona → nessuna notifica e
 * `ultimaEspansioneAt = null` (il primo tick in orario espanderà subito).
 *
 * Nome storicamente `avviaRound1ForPratica`: MANTENUTO perché il submit e la
 * revoca lo importano.
 */
export async function avviaRound1ForPratica(praticaId: string): Promise<{
  assegnazioni: number;
  stato: string;
  newAssegnazioniIds: string[];
}> {
  const { result, jobs } = await prisma.$transaction(async (tx) => {
    const pratica = await tx.pratica.findUnique({
      where: { id: praticaId },
      include: { assegnazioni: { select: { sedeId: true, ciclo: true, esito: true } } },
    });
    if (!pratica) throw new Error('Pratica non trovata');

    const cfg = await getDistribuzioneConfig(tx);
    const now = new Date();
    const statoDa = pratica.stato;

    let newIds: string[] = [];
    if (pratica.lat != null && pratica.lng != null) {
      const origine: LatLng = { lat: pratica.lat, lng: pratica.lng };
      const candidati = await candidatiEntro(tx, pratica, origine, cfg.raggioStartM, now);
      newIds = await creaAssegnazioni(
        tx,
        praticaId,
        pratica.distribuzioneCiclo,
        cfg.raggioStartM,
        candidati,
        now,
      );
    }

    await tx.pratica.update({
      where: { id: praticaId },
      data: {
        stato: 'IN_DISTRIBUZIONE',
        raggioCorrenteM: cfg.raggioStartM,
        // Solo se abbiamo davvero notificato: altrimenti null → il primo tick espande.
        ultimaEspansioneAt: newIds.length > 0 ? now : null,
        zonaNonCopertaAt: null,
      },
    });

    await logCambioStato(tx, {
      praticaId,
      statoDa,
      statoA: 'IN_DISTRIBUZIONE',
      tipoEvento: STATO_EVENTO.SUBMIT,
      meta: { raggioM: cfg.raggioStartM, ciclo: pratica.distribuzioneCiclo, assegnazioni: newIds.length },
    });

    return {
      result: {
        assegnazioni: newIds.length,
        stato: 'IN_DISTRIBUZIONE',
        newAssegnazioniIds: newIds,
      },
      jobs: { newAssegnazioniIds: newIds, zonaNonCopertaPraticaId: null },
    };
  });

  await processPostCommitJobs(jobs);
  return result;
}

/**
 * Tick di tutte le pratiche in distribuzione (chiamato dal cron ogni 10 min).
 * Paginazione difensiva: `take` cap per non fare esplodere un tick.
 */
export async function tickAllPraticheInDistribuzione(): Promise<{
  scanned: number;
  expanded: number;
  zonaNonCoperta: number;
}> {
  const pratiche = await prisma.pratica.findMany({
    where: { stato: 'IN_DISTRIBUZIONE', zonaNonCopertaAt: null, deletedAt: null },
    select: { id: true },
    take: 500,
  });

  const counters = { scanned: 0, expanded: 0, zonaNonCoperta: 0 };
  for (const p of pratiche) {
    counters.scanned += 1;
    const r = await tickPratica(p.id);
    if (r.status === 'notified') counters.expanded += 1;
    if (r.status === 'zona-non-coperta') counters.zonaNonCoperta += 1;
  }
  return counters;
}

export async function processPostCommitJobs(jobs: PostCommitJobs): Promise<void> {
  if (jobs.newAssegnazioniIds.length > 0) {
    await emitN6ForAssegnazioni(jobs.newAssegnazioniIds);
  }
  if (jobs.zonaNonCopertaPraticaId) {
    await emitZonaNonCopertaNotifications(jobs.zonaNonCopertaPraticaId);
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

/**
 * Zona non coperta: nessuna agenzia entro il raggio massimo. Avvisa SOLO il
 * broker (N52 + evento modale, riusa `eventoPraticaEscalation`): gli admin la
 * vedono nel monitoraggio, niente email admin. Le PENDING restano accettabili.
 */
async function emitZonaNonCopertaNotifications(praticaId: string): Promise<void> {
  const pratica = await prisma.pratica.findUnique({
    where: { id: praticaId },
    select: {
      brokerId: true,
      brokerSedeId: true,
      codicePratica: true,
      veicoli: { orderBy: { ordine: 'asc' }, select: { targa: true } },
    },
  });
  if (!pratica) return;

  const cfg = await getDistribuzioneConfig();
  const raggioMaxKm = cfg.raggioMaxM / 1000;
  const targaPratica =
    pratica.veicoli[0]?.targa
      ? pratica.veicoli.length > 1
        ? `${pratica.veicoli[0].targa} +${pratica.veicoli.length - 1}`
        : pratica.veicoli[0].targa
      : null;

  // Recapito: chi ha creato la pratica; se non più raggiungibile la catena
  // scende alla sua sede, poi all'admin azienda. Vedi lib/notifiche/pratica.ts.
  const destinatari = await destinatariBroker(praticaId);
  for (const d of destinatari) {
    // Un destinatario che fallisce non deve azzerare l'invio agli altri.
    await sendNotification({
      tipo: 'N52_BROKER_ZONA_NON_COPERTA',
      target: { email: d.email, userId: d.userId, companyId: pratica.brokerId },
      payload: {
        codicePratica: pratica.codicePratica ?? '—',
        targa: targaPratica,
        nomeBroker: d.nome,
        raggioMaxKm,
      },
    }).catch(() => undefined);
  }

  // Evento in-app (modale) per il broker: nessuna agenzia disponibile in zona.
  if (pratica.codicePratica) {
    await emitEventoPratica(
      prisma,
      eventoPraticaEscalation({
        praticaId,
        brokerId: pratica.brokerId,
        sedeId: pratica.brokerSedeId,
        codicePratica: pratica.codicePratica,
      }),
    ).catch(() => undefined);
  }
}
