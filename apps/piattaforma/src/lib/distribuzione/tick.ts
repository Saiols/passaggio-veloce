import 'server-only';
import { prisma, type Prisma, type PrismaClient } from '@pv/db';
import { getDistribuzioneConfig, type DistribuzioneConfigDTO } from './config';
import { isOrarioLavorativo, minutiLavorativiTra } from './orario-piattaforma';
import { primoAnello, prossimoAnello, type SedeConDistanza } from './anelli';
import { sediDaEscludere } from './esclusioni';
import { limiteVisuraUtc } from '@/lib/visura/validita';
import { distanceKm } from '@/lib/geo/coords';

/** Coppia di coordinate (origine pratica o sede). */
export type LatLng = { lat: number; lng: number };
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
  | { status: 'notified'; assegnazioni: number; raggioM: number; round: number }
  | { status: 'ripresa'; assegnazioni: number; raggioM: number; round: number }
  | { status: 'zona-non-coperta' }
  | { status: 'closed'; finalStato: 'ACCETTATA' | 'ANNULLATA' | 'FIRMATA' | 'SCADUTA' };

const STATI_TERMINALI = ['ACCETTATA', 'FIRMATA', 'ANNULLATA', 'SCADUTA'] as const;

/**
 * Grazia (min) sul gate della durata round. Il cron gira ogni minuto
 * (vercel.json) e Vercel non garantisce il trigger al secondo: senza grazia
 * un tick che arriva un istante prima della scadenza slitterebbe di un giro
 * intero.
 *
 * È un valore ASSOLUTO — 0,2 min = 12 secondi — non proporzionale alla durata
 * del round (il minimo vive in `validate.ts`, non qui, e non va duplicato).
 * Su un round da 1 minuto quei 12 secondi sono il 20% della durata; su un
 * round da 60 minuti sono lo 0,3%: l'incidenza cambia molto, ed è accettato
 * consapevolmente. L'alternativa — una grazia proporzionale, quindi più
 * stretta sui round corti — sembra più fedele ma peggiora l'esito: un tick
 * che arriva a ridosso della scadenza verrebbe respinto e il round
 * slitterebbe al giro di cron successivo, RADDOPPIANDO la sua durata (1 min
 * → 2 min). Restare corti di 12 secondi è un errore molto più piccolo che
 * raddoppiare il round.
 */
const ESPANSIONE_GRACE_MIN = 0.2;

/** Client Prisma base o transazione: le letture/candidati girano FUORI dalla tx. */
type DistribClient = PrismaClient | Prisma.TransactionClient;

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
 * Sedi agenzia candidate con distanza in LINEA D'ARIA (m) entro `sogliaM`,
 * escluse quelle già contattate nel ciclo / revocate permanentemente.
 *
 * Il raggio è per definizione in linea d'aria: `distanceKm` (Haversine) è la
 * misura, non un prefiltro di un calcolo stradale. Nessuna chiamata di rete,
 * quindi nessun rischio di P2028 — la funzione resta comunque chiamata FUORI
 * da `prisma.$transaction` perché il compare-and-set della tx corta, che
 * protegge da accettazioni/revoche in race, si basa sui candidati calcolati
 * prima di aprirla.
 *
 * Query `where` invariata: AGENZIA, non deleted/suspended, coord presenti,
 * company non bloccata e con visura valida, `id notIn sediDaEscludere`.
 */
async function candidatiEntro(
  client: DistribClient,
  pratica: PraticaCandidati,
  origine: LatLng,
  sogliaM: number,
  now: Date,
): Promise<SedeConDistanza[]> {
  const sediContattate = sediDaEscludere(pratica);

  const sediIdonee = await client.sede.findMany({
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

  const out: SedeConDistanza[] = [];
  for (const s of sediIdonee) {
    if (s.lat == null || s.lng == null) continue;
    const distanzaM = Math.round(distanceKm(origine, { lat: s.lat, lng: s.lng }) * 1000);
    if (distanzaM <= sogliaM) {
      out.push({ sedeId: s.id, companyId: s.companyId, distanzaM });
    }
  }
  return out;
}

/**
 * Crea le PraticaAssegnazione PENDING per le sedi dell'anello raggiunto.
 * Ritorna gli id creati (per la N6 post-commit).
 *
 * `round` è il numero del batch, non del raggio: gli anelli vuoti attraversati
 * per arrivare a `raggioM` non lo hanno fatto avanzare.
 */
async function creaAssegnazioni(
  tx: Prisma.TransactionClient,
  praticaId: string,
  ciclo: number,
  round: number,
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
        round,
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

/** Scrittura "zona non coperta" (update + log) dentro una tx. */
async function markZonaNonCoperta(
  tx: Prisma.TransactionClient,
  praticaId: string,
  cfg: DistribuzioneConfigDTO,
  now: Date,
  meta: Record<string, unknown>,
): Promise<void> {
  await tx.pratica.update({
    where: { id: praticaId },
    data: { raggioCorrenteM: cfg.raggioMaxM, zonaNonCopertaAt: now },
  });
  await logCambioStato(tx, {
    praticaId,
    statoDa: 'IN_DISTRIBUZIONE',
    statoA: 'IN_DISTRIBUZIONE',
    tipoEvento: STATO_EVENTO.ESCALATION,
    meta,
  });
}

/**
 * True se l'errore è un vincolo unico violato (P2002): un tick concorrente ha
 * già creato la stessa assegnazione. La tx corta fa rollback ATOMICO → nessuna
 * scrittura parziale; il chiamante lo assorbe come noop (l'altro tick ha già
 * notificato). Confronto sul `code` (non `instanceof`) per non dipendere dalla
 * classe Prisma nei mock dei test.
 */
function isUniqueViolation(e: unknown): boolean {
  return (e as { code?: string })?.code === 'P2002';
}

/**
 * Tick di espansione per UNA pratica in distribuzione.
 *
 * Struttura in tre fasi (la tx resta corta e senza I/O):
 *  1. FUORI tx: config + lettura pratica + guardie (terminale/stato/zona non
 *     coperta/coord-null) + gate orario + gate durata round → noop early.
 *  2. FUORI tx: `candidatiEntro` (query sede + distanza in linea d'aria).
 *  3. Tx CORTA: re-legge la pratica fresca, ri-verifica le guardie e che
 *     `raggioCorrenteM`/`distribuzioneCiclo` non siano cambiati (accept/tick/
 *     revoca in race → noop, nessuna scrittura), ricalcola le esclusioni sulle
 *     assegnazioni fresche filtrando i candidati pre-calcolati, poi
 *     `prossimoAnello` e le scritture.
 *  4. Post-commit: N6 (notifica) / N52 (zona non coperta).
 */
export async function tickPratica(praticaId: string): Promise<TickResult> {
  const cfg = await getDistribuzioneConfig();
  const now = new Date();

  // ---- Step 1: lettura + guardie FUORI da qualsiasi transazione ----
  const pratica = await prisma.pratica.findUnique({
    where: { id: praticaId },
    include: { assegnazioni: { select: { sedeId: true, ciclo: true, esito: true } } },
  });
  if (!pratica) return noop('pratica non trovata');

  // Terminale (incl. ACCETTATA) → uscita dalla distribuzione.
  if ((STATI_TERMINALI as readonly string[]).includes(pratica.stato)) {
    return {
      status: 'closed',
      finalStato: pratica.stato as 'ACCETTATA' | 'ANNULLATA' | 'FIRMATA' | 'SCADUTA',
    };
  }

  // Stato non gestito da questo motore (es. BOZZA, PROCESSATA, IN_ATTESA_ROUND_* legacy).
  if (pratica.stato !== 'IN_DISTRIBUZIONE') {
    return noop(`stato ${pratica.stato} non gestito`);
  }

  // Nota: NON c'è più una guardia di uscita anticipata su `zonaNonCopertaAt`.
  // Una pratica ferma prosegue nel flusso normale: se un'agenzia idonea si è
  // registrata in zona nel frattempo, la ripresa avviene più sotto (dentro la
  // tx), ripartendo dal raggio iniziale (vedi `inRipresa`).

  // Coordinate mancanti → non calcolabile (guardia difensiva: il submit le rende
  // obbligatorie). A differenza della zona non coperta "normale" (nessuna sede in
  // raggio), qui non esiste ripresa possibile: lat/lng non vengono mai valorizzate
  // da nessun percorso dopo la creazione. Se già marcata, uscita SENZA scritture
  // né notifiche: altrimenti ogni tick (ogni minuto) rimanderebbe la N52 al broker.
  if (pratica.lat == null || pratica.lng == null) {
    if (pratica.zonaNonCopertaAt) {
      return noop('zona non coperta: coordinate mancanti');
    }
    const jobs = await scriviZonaNonCoperta(praticaId, cfg, now, {
      zonaNonCoperta: true,
      motivo: 'coordinate-mancanti',
      ciclo: pratica.distribuzioneCiclo,
    });
    await processPostCommitJobs(jobs);
    return { status: 'zona-non-coperta' };
  }

  // Fuori orario lavorativo piattaforma → pausa (nessuno stato cambia).
  if (!isOrarioLavorativo(now, cfg)) {
    return noop('fuori orario');
  }

  // Gate durata round, misurata in minuti LAVORATIVI: i minuti fuori finestra,
  // nei giorni spenti e nei festivi non contano. Così ogni cerchio ha la sua
  // finestra piena per rispondere anche quando la pratica è arrivata di notte.
  // Solo le notifiche reali muovono `ultimaEspansioneAt`: un round vuoto non
  // consuma tempo.
  if (
    pratica.ultimaEspansioneAt &&
    minutiLavorativiTra(pratica.ultimaEspansioneAt, now, cfg, cfg.intervalloMin) <
      cfg.intervalloMin - ESPANSIONE_GRACE_MIN
  ) {
    return noop('durata round non trascorsa');
  }

  // ---- Step 2: candidati (query sede + distanza in linea d'aria) FUORI tx ----
  const origine: LatLng = { lat: pratica.lat, lng: pratica.lng };
  const candidati = await candidatiEntro(prisma, pratica, origine, cfg.raggioMaxM, now);

  // Snapshot per il compare-and-set in-tx (rileva accept/tick/revoca in race).
  const snapCiclo = pratica.distribuzioneCiclo;
  const snapRaggio = pratica.raggioCorrenteM ?? null;

  // ---- Step 3: transazione CORTA — re-check + scritture, nessuna I/O di rete ----
  let outcome: { result: TickResult; jobs: PostCommitJobs };
  try {
    outcome = await prisma.$transaction(async (tx) => {
      const fresh = await tx.pratica.findUnique({
        where: { id: praticaId },
        include: { assegnazioni: { select: { sedeId: true, ciclo: true, esito: true } } },
      });
      // Re-check guardie: qualcosa è cambiato dopo lo Step 1 → abort senza scritture.
      // `fresh.zonaNonCopertaAt` NON è più fra queste condizioni: è proprio la
      // ripresa (gestita sotto) che deve poter procedere quando è impostato.
      if (
        !fresh ||
        fresh.stato !== 'IN_DISTRIBUZIONE' ||
        fresh.distribuzioneCiclo !== snapCiclo ||
        (fresh.raggioCorrenteM ?? null) !== snapRaggio
      ) {
        return { result: noop('race: stato cambiato durante il tick'), jobs: emptyJobs() };
      }

      // Ricalcola le esclusioni sulle assegnazioni fresche e filtra i candidati
      // pre-calcolati (una sede contattata nel frattempo va tolta).
      const escludere = new Set(sediDaEscludere(fresh));
      const candidatiFiltrati = candidati.filter((c) => !escludere.has(c.sedeId));

      // Una pratica ferma in zona non coperta riparte dal raggio INIZIALE: il
      // suo `raggioCorrenteM` è al massimo, e `prossimoAnello` partendo da lì
      // non entrerebbe mai nel ciclo. Le agenzie registrate dopo la dichiarazione
      // possono essere ovunque entro il raggio massimo, quindi si riapre il
      // ventaglio dalla più vicina, come al primo giro.
      const inRipresa = fresh.zonaNonCopertaAt !== null;
      const res = inRipresa
        ? primoAnello(candidatiFiltrati, cfg)
        : prossimoAnello(candidatiFiltrati, fresh.raggioCorrenteM ?? cfg.raggioStartM, cfg);

      if (res.tipo === 'notifica') {
        // Il round avanza SOLO qui, dove parte un batch reale: gli anelli vuoti
        // attraversati da `prossimoAnello` non lo consumano.
        const round = fresh.roundCorrente + 1;
        const newIds = await creaAssegnazioni(
          tx,
          praticaId,
          fresh.distribuzioneCiclo,
          round,
          res.raggioRaggiuntoM,
          res.sedi,
          now,
        );
        await tx.pratica.update({
          where: { id: praticaId },
          data: {
            raggioCorrenteM: res.raggioRaggiuntoM,
            ultimaEspansioneAt: now,
            roundCorrente: round,
            // La ripresa toglie il marchio: la pratica è di nuovo in gara.
            ...(inRipresa ? { zonaNonCopertaAt: null } : {}),
          },
        });
        await logCambioStato(tx, {
          praticaId,
          statoDa: 'IN_DISTRIBUZIONE',
          statoA: 'IN_DISTRIBUZIONE',
          tipoEvento: STATO_EVENTO.ROUND_ADVANCE,
          meta: {
            raggioM: res.raggioRaggiuntoM,
            round,
            ciclo: fresh.distribuzioneCiclo,
            // Distingue nel monitoraggio un round normale da una ripresa.
            ...(inRipresa ? { ripresa: true } : {}),
          },
        });
        return {
          result: {
            status: inRipresa ? ('ripresa' as const) : ('notified' as const),
            assegnazioni: newIds.length,
            raggioM: res.raggioRaggiuntoM,
            round,
          },
          jobs: { newAssegnazioniIds: newIds, zonaNonCopertaPraticaId: null },
        };
      }

      // Nessuna sede disponibile. Se la pratica era GIÀ in zona non coperta non
      // si riscrive nulla: lo stato è invariato e una seconda N52 al broker
      // sarebbe rumore a ogni tick.
      if (inRipresa) {
        return {
          result: noop('zona non coperta: nessuna sede nuova'),
          jobs: emptyJobs(),
        };
      }

      // zona-non-coperta: nessuna sede entro il raggio massimo.
      await markZonaNonCoperta(tx, praticaId, cfg, now, {
        zonaNonCoperta: true,
        raggioM: cfg.raggioMaxM,
        ciclo: fresh.distribuzioneCiclo,
      });
      return {
        result: { status: 'zona-non-coperta' },
        jobs: { newAssegnazioniIds: [], zonaNonCopertaPraticaId: praticaId },
      };
    });
  } catch (e) {
    // Duplicato da race (P2002): la tx corta ha fatto rollback atomico (nessuna
    // scrittura parziale). Lo assorbiamo come noop — l'altro tick ha già creato
    // e notificato; il cron ritenta al giro successivo.
    if (isUniqueViolation(e)) return noop('race: assegnazione duplicata');
    throw e;
  }

  await processPostCommitJobs(outcome.jobs);
  return outcome.result;
}

/**
 * Tx corta che marca "zona non coperta" (usata dalla guardia coord-null di
 * `tickPratica`). Re-legge lo stato e scrive solo se ancora applicabile.
 */
async function scriviZonaNonCoperta(
  praticaId: string,
  cfg: DistribuzioneConfigDTO,
  now: Date,
  meta: Record<string, unknown>,
): Promise<PostCommitJobs> {
  await prisma.$transaction(async (tx) => {
    const fresh = await tx.pratica.findUnique({
      where: { id: praticaId },
      select: { stato: true, zonaNonCopertaAt: true },
    });
    if (!fresh || fresh.stato !== 'IN_DISTRIBUZIONE' || fresh.zonaNonCopertaAt) return;
    await markZonaNonCoperta(tx, praticaId, cfg, now, meta);
  });
  return { newAssegnazioniIds: [], zonaNonCopertaPraticaId: praticaId };
}

/**
 * Primo round al submit (o al ricircolo dopo revoca): porta la pratica in
 * `IN_DISTRIBUZIONE` e contatta le sedi del primo anello NON VUOTO, partendo da
 * `raggioStartM` ed espandendo a step fino a `raggioMaxM` — un raggio iniziale
 * senza agenzie non fa aspettare il primo tick del cron. **Ignora l'orario
 * lavorativo** (il primo round parte a qualsiasi ora).
 *
 * Se nemmeno il raggio massimo contiene una sede, la pratica è dichiarata zona
 * non coperta subito: il broker riceve la N52 al submit, non al primo tick
 * utile. Stesso esito per una pratica senza coordinate (guardia difensiva: il
 * submit le rende obbligatorie).
 *
 * Come `tickPratica`: la query candidati gira FUORI dalla tx; la tx corta
 * re-legge la pratica (esclusioni fresche + filtro) e fa solo le scritture.
 *
 * Nome storicamente `avviaRound1ForPratica`: MANTENUTO perché il submit e la
 * revoca lo importano.
 */
export async function avviaRound1ForPratica(praticaId: string): Promise<{
  assegnazioni: number;
  stato: string;
  newAssegnazioniIds: string[];
}> {
  const cfg = await getDistribuzioneConfig();
  const now = new Date();

  // ---- Step 1: lettura FUORI tx ----
  const pratica = await prisma.pratica.findUnique({
    where: { id: praticaId },
    include: { assegnazioni: { select: { sedeId: true, ciclo: true, esito: true } } },
  });
  if (!pratica) throw new Error('Pratica non trovata');

  // ---- Step 2: candidati FUORI tx, fino al raggio MASSIMO (non più solo il
  // raggio iniziale): serve a saltare in un colpo solo gli anelli vuoti. ----
  let candidati: SedeConDistanza[] = [];
  if (pratica.lat != null && pratica.lng != null) {
    const origine: LatLng = { lat: pratica.lat, lng: pratica.lng };
    candidati = await candidatiEntro(prisma, pratica, origine, cfg.raggioMaxM, now);
  }

  // ---- Step 3: tx CORTA — re-read (esclusioni fresche + filtro), scritture ----
  const { result, jobs } = await prisma.$transaction(async (tx) => {
    const fresh = await tx.pratica.findUnique({
      where: { id: praticaId },
      include: { assegnazioni: { select: { sedeId: true, ciclo: true, esito: true } } },
    });
    if (!fresh) throw new Error('Pratica non trovata');
    const statoDa = fresh.stato;

    const escludere = new Set(sediDaEscludere(fresh));
    const candidatiFiltrati = candidati.filter((c) => !escludere.has(c.sedeId));
    const res = primoAnello(candidatiFiltrati, cfg);

    if (res.tipo === 'zona-non-coperta') {
      await tx.pratica.update({
        where: { id: praticaId },
        data: {
          stato: 'IN_DISTRIBUZIONE',
          raggioCorrenteM: cfg.raggioMaxM,
          ultimaEspansioneAt: null,
          zonaNonCopertaAt: now,
          // Nessun batch notificato: il round resta a 0 per questo ciclo.
          roundCorrente: 0,
        },
      });
      await logCambioStato(tx, {
        praticaId,
        statoDa,
        statoA: 'IN_DISTRIBUZIONE',
        tipoEvento: STATO_EVENTO.SUBMIT,
        // La chiave `motivo` va OMESSA quando non si applica, non messa a
        // `undefined`: Prisma rifiuta `undefined` dentro un campo JSON.
        meta: {
          zonaNonCoperta: true,
          raggioM: cfg.raggioMaxM,
          ciclo: fresh.distribuzioneCiclo,
          assegnazioni: 0,
          ...(pratica.lat == null || pratica.lng == null
            ? { motivo: 'coordinate-mancanti' }
            : {}),
        },
      });
      return {
        result: { assegnazioni: 0, stato: 'IN_DISTRIBUZIONE', newAssegnazioniIds: [] },
        jobs: { newAssegnazioniIds: [], zonaNonCopertaPraticaId: praticaId },
      };
    }

    // Primo batch del ciclo: il round riparte sempre da 1, anche dopo un
    // ricircolo (`distribuzioneCiclo` incrementato dalla revoca admin).
    const round = 1;
    const newIds = await creaAssegnazioni(
      tx,
      praticaId,
      fresh.distribuzioneCiclo,
      round,
      res.raggioRaggiuntoM,
      res.sedi,
      now,
    );

    await tx.pratica.update({
      where: { id: praticaId },
      data: {
        stato: 'IN_DISTRIBUZIONE',
        raggioCorrenteM: res.raggioRaggiuntoM,
        ultimaEspansioneAt: now,
        zonaNonCopertaAt: null,
        roundCorrente: round,
      },
    });

    await logCambioStato(tx, {
      praticaId,
      statoDa,
      statoA: 'IN_DISTRIBUZIONE',
      tipoEvento: STATO_EVENTO.SUBMIT,
      meta: {
        raggioM: res.raggioRaggiuntoM,
        round,
        ciclo: fresh.distribuzioneCiclo,
        assegnazioni: newIds.length,
      },
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
 * Tick di tutte le pratiche in distribuzione (chiamato dal cron ogni minuto).
 * Paginazione difensiva: `take` cap per non fare esplodere un tick.
 *
 * Isolamento per-pratica: un errore su una pratica (P2028, blip DB, ...) è
 * catturato, conteggiato in `errors` e NON aborta il batch — le altre pratiche
 * vengono comunque processate.
 */
export async function tickAllPraticheInDistribuzione(): Promise<{
  scanned: number;
  expanded: number;
  riprese: number;
  zonaNonCoperta: number;
  errors: number;
}> {
  const pratiche = await prisma.pratica.findMany({
    // `zonaNonCopertaAt` NON è più un filtro: una pratica dichiarata scoperta
    // deve poter ripartire quando un'agenzia idonea si registra nella sua zona.
    where: { stato: 'IN_DISTRIBUZIONE', deletedAt: null },
    select: { id: true },
    take: 500,
  });

  const counters = { scanned: 0, expanded: 0, riprese: 0, zonaNonCoperta: 0, errors: 0 };
  for (const p of pratiche) {
    counters.scanned += 1;
    try {
      const r = await tickPratica(p.id);
      if (r.status === 'notified') counters.expanded += 1;
      if (r.status === 'ripresa') counters.riprese += 1;
      if (r.status === 'zona-non-coperta') counters.zonaNonCoperta += 1;
    } catch {
      // Una pratica non deve mai abortire l'intero giro di cron.
      counters.errors += 1;
      continue;
    }
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
