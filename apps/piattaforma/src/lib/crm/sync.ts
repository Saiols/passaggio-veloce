import 'server-only';
import { prisma } from '@pv/db';
import { calcolaProposte } from './match/engine';
import { applicaProposte } from './match/apply';

/**
 * Sync engine CRM ↔ piattaforma. Tre punti d'aggancio:
 *
 * 1. `tryMatchCrmContact(companyId)` — chiamato dopo Company.create
 *    (registrazione wizard). Delega al motore unico di match
 *    (lib/crm/match/), limitato all'azienda appena creata, e applica le
 *    proposte trovate. Decisione D-12 spec §7.
 *
 * 2. `onPraticaFirmata(praticaId)` — chiamato dopo prima `Pratica.update
 *    {stato: FIRMATA}`. Se il broker ha un CrmContact agganciato:
 *    - Prima pratica: S7 → S8, primaPratica=true, primaPraticaAt=now
 *    - Pratica ricorrente: S8 → S9
 *
 * 3. `syncCrmFromPlatform()` — cron job che aggiorna gli aggregati
 *    `platStatus`, `praticheTotal`, `praticheMonth`, `lastAccessAt`,
 *    `tassoComp` per tutti i contatti già linkati a una Company.
 */

const STATUS_S8 = 'S8' as const;
const STATUS_S9 = 'S9' as const;

export type MatchResult =
  | { matched: true; contactId: string; via: string }
  | { matched: false };

/**
 * Match alla registrazione: stesse regole della riconciliazione retroattiva,
 * limitate all'azienda appena creata (e alle sue sedi).
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
    const proposte = await calcolaProposte({ companyId });
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
 * Hook post-firma. Promuove lo stato del CrmContact agganciato al broker
 * della pratica:
 * - Mai firmato prima (primaPratica=false): → S8 + primaPratica=true
 * - Già firmato (primaPratica=true): → S9 (ricorrente)
 *
 * Best-effort, non rilancia errori.
 */
export async function onPraticaFirmata(praticaId: string): Promise<void> {
  try {
    const pratica = await prisma.pratica.findUnique({
      where: { id: praticaId },
      select: { brokerId: true, stato: true },
    });
    if (!pratica || pratica.stato !== 'FIRMATA') return;

    const contact = await prisma.crmContact.findFirst({
      where: { companyId: pratica.brokerId, deletedAt: null },
      select: { id: true, status: true, primaPratica: true },
    });
    if (!contact) return;

    if (!contact.primaPratica) {
      await prisma.crmContact.update({
        where: { id: contact.id },
        data: {
          status: STATUS_S8,
          primaPratica: true,
          primaPraticaAt: new Date(),
          platStatus: 'ATTIVO',
        },
      });
    } else if (contact.status !== STATUS_S9) {
      await prisma.crmContact.update({
        where: { id: contact.id },
        data: { status: STATUS_S9, platStatus: 'ATTIVO' },
      });
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

    const [company, totalAgg, monthAgg, firmateAgg, lastUser] = await Promise.all([
      prisma.company.findUnique({
        where: { id: c.companyId },
        select: { suspendedAt: true, deletedAt: true },
      }),
      prisma.pratica.count({
        where: { brokerId: c.companyId, deletedAt: null },
      }),
      prisma.pratica.count({
        where: {
          brokerId: c.companyId,
          deletedAt: null,
          createdAt: { gte: startOfMonth },
        },
      }),
      prisma.pratica.count({
        where: {
          brokerId: c.companyId,
          deletedAt: null,
          stato: 'FIRMATA',
        },
      }),
      prisma.user.findFirst({
        where: { companyId: c.companyId, deletedAt: null },
        orderBy: { lastLoginAt: 'desc' },
        select: { lastLoginAt: true },
      }),
    ]);

    if (!company) continue;

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

