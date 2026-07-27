import 'server-only';
import { prisma, type Prisma } from '@pv/db';
import { calcolaProposte } from './match/engine';
import { applicaProposte } from './match/apply';
import { catDaType } from './match/identita';
import { datiFunnel } from './match/stato';
import { storicoAzienda } from './match/storico';

/**
 * Sync engine CRM ↔ piattaforma. Tre punti d'aggancio:
 *
 * 1. `tryMatchCrmContact(companyId)` — chiamato dopo Company.create
 *    (registrazione wizard). Delega al motore unico di match
 *    (lib/crm/match/), limitato all'azienda appena creata, e applica le
 *    proposte trovate. Decisione D-12 spec §7.
 *
 * 2. `onPraticaFirmata(praticaId)` — chiamato dopo `Pratica.update
 *    {stato: FIRMATA}`. Riallinea TUTTI i contatti CRM agganciati alle due
 *    aziende che hanno lavorato la pratica (broker e agenzia assegnata) con
 *    le stesse regole dell'aggancio: `datiFunnel` in match/stato.ts.
 *
 * 3. `syncCrmFromPlatform()` — cron job che aggiorna gli aggregati
 *    `platStatus`, `praticheTotal`, `praticheMonth`, `lastAccessAt`,
 *    `tassoComp` per tutti i contatti già linkati a una Company.
 */

export type MatchResult =
  | { matched: true; contactId: string; via: string }
  | { matched: false };

/**
 * Match alla registrazione: stesse regole della riconciliazione retroattiva,
 * limitate all'azienda appena creata (e alle sue sedi).
 *
 * Anche questo è un canale AUTOMATICO (nessuno guarda un'anteprima prima che
 * scriva), quindi vale la stessa regola del cron: le proposte ambigue —
 * ex aequo di punteggio, spareggio arbitrario nel merito e nessun percorso di
 * sgancio — non si applicano qui e restano alla pagina admin.
 *
 * Best-effort: chiamata dopo la tx di registrazione, non deve mai farla
 * fallire. Prima qui viveva una cascade email → tel → P.IVA che confrontava il
 * telefono normalizzato con `CrmContact.tel` grezzo e quindi non trovava mai
 * nulla; ora la logica è una sola, in lib/crm/match/.
 */
export async function tryMatchCrmContact(
  companyId: string,
): Promise<MatchResult> {
  try {
    const tutte = await calcolaProposte({ companyId });
    const proposte = tutte.filter((p) => !p.ambigua);
    if (proposte.length === 0) return { matched: false };
    const esito = await applicaProposte(proposte);
    if (esito.agganciati === 0) return { matched: false };
    const prima = proposte[0]!;
    return { matched: true, contactId: prima.contactId, via: prima.campi.join('+') };
  } catch {
    return { matched: false };
  }
}

/**
 * Riallinea al funnel tutti i contatti CRM agganciati a una company.
 *
 * "Tutti", non uno: per decisione di progetto (spec D3) una company può avere
 * più contatti agganciati — la madre e una riga per ciascuna sede. Un
 * `findFirst` senza `orderBy` ne sceglieva uno a caso e lasciava indietro gli
 * altri.
 */
async function allineaContattiAgganciati(companyId: string): Promise<void> {
  const contatti = await prisma.crmContact.findMany({
    where: { companyId, deletedAt: null },
    select: { id: true, status: true },
  });
  if (contatti.length === 0) return;

  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { type: true },
  });
  if (!company) return;

  const storico = await storicoAzienda(companyId, catDaType(company.type));
  if (!storico) return;

  for (const c of contatti) {
    const funnel = datiFunnel(c.status, storico);
    // Compare-and-set sullo stato appena letto, come in apply.ts: fra la
    // lettura e la scrittura un admin può portare il contatto a S10 da
    // un'altra richiesta, e quella decisione umana deve vincere.
    await prisma.crmContact.updateMany({
      where: { id: c.id, deletedAt: null, status: c.status },
      data: {
        status: funnel.status as Prisma.CrmContactUncheckedUpdateManyInput['status'],
        platStatus: funnel.platStatus,
        primaPratica: funnel.primaPratica,
        primaPraticaAt: funnel.primaPraticaAt,
      },
    });
  }
}

/**
 * Hook post-firma. Riallinea i contatti CRM agganciati alle aziende che hanno
 * lavorato la pratica.
 *
 * Fino a questo branch i contatti agganciati erano ZERO, quindi questa
 * funzione era codice morto e le sue scorciatoie non si vedevano. Da ora è il
 * modulo che muove lo stato dei contatti agganciati, e deve rispettare le
 * stesse quattro regole di `apply.ts`:
 * - S10 non si tocca mai (churn: decisione umana);
 * - lo stato non retrocede (un contatto portato a S9 a mano non torna a S8);
 * - le pratiche di un'agenzia si contano su `agenziaAssegnataId`, non su
 *   `brokerId` — guardare solo il broker lasciava a S7 per sempre le 7.880
 *   righe agenzia della lista, perché `syncCrmFromPlatform` aggiorna gli
 *   aggregati ma non lo `status` e il motore salta le identità già agganciate;
 * - si aggiornano TUTTI i contatti agganciati, non uno scelto a caso.
 *
 * Best-effort, non rilancia errori.
 */
export async function onPraticaFirmata(praticaId: string): Promise<void> {
  try {
    const pratica = await prisma.pratica.findUnique({
      where: { id: praticaId },
      select: { brokerId: true, agenziaAssegnataId: true, stato: true },
    });
    if (!pratica || pratica.stato !== 'FIRMATA') return;

    // Le due aziende che hanno lavorato la pratica. Il broker la crea, l'
    // agenzia la evade: entrambe sono in lista CRM e per entrambe questa
    // firma è un avanzamento del funnel.
    const aziende = [...new Set(
      [pratica.brokerId, pratica.agenziaAssegnataId].filter(
        (id): id is string => !!id,
      ),
    )];

    for (const companyId of aziende) {
      await allineaContattiAgganciati(companyId);
    }
  } catch {
    // best-effort, ignora
  }
}

/**
 * Cron sync: ricalcola gli aggregati per i CrmContact agganciati a Company.
 * Ritorna numero di contatti aggiornati. Rapidità: una query per company
 * coinvolta — accettabile fino a ~10k contatti, oltre serve batching.
 */
export async function syncCrmFromPlatform(): Promise<{
  scanned: number;
  updated: number;
}> {
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  const contacts = await prisma.crmContact.findMany({
    where: { deletedAt: null, companyId: { not: null } },
    select: { id: true, companyId: true },
  });

  let updated = 0;
  for (const c of contacts) {
    if (!c.companyId) continue;

    const company = await prisma.company.findUnique({
      where: { id: c.companyId },
      select: { type: true, suspendedAt: true, deletedAt: true },
    });
    if (!company) continue;

    // Le pratiche di un'agenzia stanno su agenziaAssegnataId: contarle su
    // brokerId lasciava ogni agenzia agganciata a 0 pratiche e INATTIVO.
    const wherePratica =
      company.type === 'AGENZIA'
        ? { agenziaAssegnataId: c.companyId }
        : { brokerId: c.companyId };

    const [totalAgg, monthAgg, firmateAgg, lastUser] = await Promise.all([
      prisma.pratica.count({ where: { ...wherePratica, deletedAt: null } }),
      prisma.pratica.count({
        where: { ...wherePratica, deletedAt: null, createdAt: { gte: startOfMonth } },
      }),
      prisma.pratica.count({
        where: { ...wherePratica, deletedAt: null, stato: 'FIRMATA' },
      }),
      prisma.user.findFirst({
        where: { companyId: c.companyId, deletedAt: null },
        orderBy: { lastLoginAt: 'desc' },
        select: { lastLoginAt: true },
      }),
    ]);

    const tassoComp =
      totalAgg > 0 ? Math.round((firmateAgg / totalAgg) * 100) : 0;

    let platStatus: 'ATTIVO' | 'INATTIVO' | 'SOSPESO' = 'INATTIVO';
    if (company.deletedAt) platStatus = 'SOSPESO';
    else if (company.suspendedAt) platStatus = 'SOSPESO';
    else if (firmateAgg > 0) platStatus = 'ATTIVO';

    await prisma.crmContact.update({
      where: { id: c.id },
      data: {
        platStatus,
        praticheTotal: totalAgg,
        praticheMonth: monthAgg,
        lastAccessAt: lastUser?.lastLoginAt ?? null,
        tassoComp,
      },
    });
    updated++;
  }

  return { scanned: contacts.length, updated };
}

