import 'server-only';
import { prisma } from '@pv/db';
import { env } from '@/env';
import { sendNotification } from '@/lib/notifiche';
import {
  giorniRimanenti,
  giorniTrascorsi,
  isInPreavviso,
  isVisuraScaduta,
} from '@/lib/visura/validita';
import { STATI_IN_CORSO } from '@/lib/pratiche/stati';
import { romeYmd, romeStartOfDay, romeEndOfDay } from '@/lib/date/rome-day';

/** `Company.visuraCameraleData` (@db.Date) -> la stringa usata come chiave di dedup. */
function visuraKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export type PreavvisoVisuraResult = {
  inScadenza: number;
  scadute: number;
  congelate: number;
};

/**
 * Preavviso e notifica di scadenza della visura camerale. Girato 1x/giorno.
 *
 * IDEMPOTENZA — indispensabile: `sendNotification` NON deduplica (crea una riga
 * `NotificaInviata` e spedisce, a ogni chiamata). Senza le guardie qui sotto il
 * cron manderebbe N46/N47/N48 ogni giorno all'infinito.
 *
 * L'ancoraggio è `payload.visuraData` (data di emissione della visura corrente,
 * ISO yyyy-mm-dd), non la data di invio: quando l'azienda carica una visura
 * nuova la chiave cambia, nessuna riga `NotificaInviata` combacia più e il
 * ciclo di avvisi si riarma da solo — nessuno stato da resettare a mano.
 *
 * Le condizioni sono `>=` (mai `==`) sul numero di giorni trascorsi: con
 * l'uguaglianza esatta un cron saltato (deploy, outage) significherebbe
 * nessuna email, mai, per quel ciclo.
 */
export async function preavvisoVisura(now: Date = new Date()): Promise<PreavvisoVisuraResult> {
  const aziende = await prisma.company.findMany({
    where: {
      deletedAt: null,
      suspendedAt: null,
      visuraCameraleData: { not: null }, // i null sono esenti: non vanno nemmeno caricati
    },
    select: {
      id: true,
      type: true,
      ragioneSociale: true,
      visuraCameraleData: true,
      // Destinatario = email di registrazione dell'admin azienda, SEMPRE dal DB
      // (mai session.user.email né Company.email). Niente admin attivo = salta,
      // nessun fallback inventato.
      users: {
        where: { role: 'ADMIN_AZIENDA', status: 'ACTIVE', deletedAt: null },
        select: { id: true, email: true },
        take: 1,
      },
    },
  });

  const rimedioUrl = `${env.NEXT_PUBLIC_APP_URL}/visura`;
  let inScadenza = 0;
  let scadute = 0;
  let congelate = 0;

  // Finestra "oggi" nel fuso di Roma: ancoraggio della dedup giornaliera N46.
  const [y, m, d] = romeYmd(now);
  const oggiDa = romeStartOfDay([y, m, d]);
  const oggiA = romeEndOfDay([y, m, d]);

  for (const a of aziende) {
    const data = a.visuraCameraleData;
    if (!data) continue; // difesa: il where sopra già lo esclude
    const admin = a.users[0];
    if (!admin) continue; // nessun destinatario: niente da mandare
    const key = visuraKey(data);
    const companyType = a.type;
    const target = { email: admin.email, userId: admin.id, companyId: a.id };

    if (isInPreavviso(data, now)) {
      // Dedup PER GIORNATA: 1 email al giorno, per i (max 5) giorni della
      // finestra di preavviso 175..179.
      const gia = await prisma.notificaInviata.findFirst({
        where: {
          companyId: a.id,
          tipo: 'N46_VISURA_IN_SCADENZA',
          payload: { path: ['visuraData'], equals: key },
          scheduledAt: { gte: oggiDa, lte: oggiA },
        },
        select: { id: true },
      });
      if (gia) continue;
      await sendNotification({
        tipo: 'N46_VISURA_IN_SCADENZA',
        target,
        payload: {
          nomeAzienda: a.ragioneSociale,
          companyType,
          giorniRimanenti: giorniRimanenti(data, now),
          rimedioUrl,
          visuraData: key,
        },
      }).catch(() => undefined);
      inScadenza++;
      continue;
    }

    if (!isVisuraScaduta(data, now)) continue;

    // Dedup PER CICLO: una sola N47 per data di emissione della visura.
    const giaScaduta = await prisma.notificaInviata.findFirst({
      where: {
        companyId: a.id,
        tipo: 'N47_VISURA_SCADUTA',
        payload: { path: ['visuraData'], equals: key },
      },
      select: { id: true },
    });
    if (!giaScaduta) {
      await sendNotification({
        tipo: 'N47_VISURA_SCADUTA',
        target,
        payload: {
          nomeAzienda: a.ragioneSociale,
          companyType,
          rimedioUrl,
          visuraData: key,
          giorniTrascorsi: giorniTrascorsi(data, now),
        },
      }).catch(() => undefined);
      scadute++;
    }

    // Agenzia bloccata: i broker delle pratiche in volo vanno avvisati che la
    // loro pratica è ferma per un adempimento altrui. Un broker (DEALER) che
    // scade non blocca le pratiche di nessun altro: solo l'AGENZIA lo fa.
    if (companyType !== 'AGENZIA') continue;
    congelate += await avvisaBrokerPraticheCongelate(a.id, a.ragioneSociale, key);
  }

  return { inScadenza, scadute, congelate };
}

/**
 * N48 ai broker delle pratiche assegnate all'agenzia scaduta e ancora "in
 * volo" (non bozze, non concluse). Dedup su (praticaId, visuraData): una
 * volta per pratica per ciclo di visura — a differenza di N47 (una per
 * azienda), qui più pratiche/broker diversi vanno avvisati indipendentemente,
 * quindi la dedup non può essere ancorata alla sola azienda-agenzia.
 *
 * ⚠️ Gli stati "in volo" vanno letti dalla FONTE UNICA `lib/pratiche/stati.ts`,
 * mai riscritti a mano qui: ogni nuovo stato dell'enum va classificato là,
 * altrimenti sparirebbe in silenzio da questo avviso.
 */
async function avvisaBrokerPraticheCongelate(
  agenziaId: string,
  nomeAgenzia: string,
  visuraKeyStr: string,
): Promise<number> {
  const pratiche = await prisma.pratica.findMany({
    where: {
      agenziaAssegnataId: agenziaId,
      deletedAt: null,
      stato: { in: [...STATI_IN_CORSO] },
    },
    select: {
      id: true,
      broker: {
        select: {
          id: true,
          ragioneSociale: true,
          users: {
            where: { role: 'ADMIN_AZIENDA', status: 'ACTIVE', deletedAt: null },
            select: { id: true, email: true },
            take: 1,
          },
        },
      },
    },
  });

  let n = 0;
  for (const p of pratiche) {
    const admin = p.broker.users[0];
    if (!admin) continue; // nessun destinatario: niente da mandare
    // Doppia condizione su `payload` (visuraData + praticaId): non si possono
    // scrivere come due chiavi `payload` nello stesso oggetto `where` (la
    // seconda sovrascriverebbe la prima in JS) — da qui l'`AND` esplicito.
    const gia = await prisma.notificaInviata.findFirst({
      where: {
        tipo: 'N48_BROKER_PRATICA_CONGELATA',
        payload: { path: ['visuraData'], equals: visuraKeyStr },
        AND: [{ payload: { path: ['praticaId'], equals: p.id } }],
      },
      select: { id: true },
    });
    if (gia) continue;
    await sendNotification({
      tipo: 'N48_BROKER_PRATICA_CONGELATA',
      target: { email: admin.email, userId: admin.id, companyId: p.broker.id },
      payload: {
        nomeBroker: p.broker.ragioneSociale,
        nomeAgenzia,
        praticaId: p.id,
        praticaUrl: `${env.NEXT_PUBLIC_APP_URL}/pratiche/${p.id}`,
        visuraData: visuraKeyStr,
      },
    }).catch(() => undefined);
    n++;
  }
  return n;
}
