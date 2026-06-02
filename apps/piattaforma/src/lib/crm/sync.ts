import 'server-only';
import { prisma, CrmFonteAcquisizione, type Prisma } from '@pv/db';
import { isPreIscrizione, normalizePhone } from './util';

export { normalizePhone };

/**
 * Sync engine CRM ↔ piattaforma. Tre punti d'aggancio:
 *
 * 1. `tryMatchCrmContact(companyId)` — chiamato dopo Company.create
 *    (registrazione wizard). Cerca un CrmContact lead con match cascade
 *    email → tel → P.IVA, lo aggancia alla Company e auto-promuove a S7
 *    (Iscritto inattivo). Decisione D-12 spec §7.
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

const STATUS_S7 = 'S7' as const;
const STATUS_S8 = 'S8' as const;
const STATUS_S9 = 'S9' as const;

export type MatchResult =
  | { matched: true; contactId: string; via: 'email' | 'tel' | 'piva' }
  | { matched: false };

/**
 * Cerca un CrmContact (non agganciato a Company) che matchi la Company
 * appena creata. Cascade: email → tel → P.IVA. Se trovato, aggancia il
 * contact alla Company e promuove status a S7.
 *
 * Best-effort: in caso di errore non rilancia (chiamato post-tx
 * registrazione, non deve far fallire la registrazione stessa).
 */
export async function tryMatchCrmContact(
  companyId: string,
): Promise<MatchResult> {
  try {
    const company = await prisma.company.findUnique({
      where: { id: companyId },
      select: {
        id: true,
        email: true,
        telefono: true,
        partitaIva: true,
        referenteId: true,
      },
    });
    if (!company) return { matched: false };

    const cascade: Array<{
      via: 'email' | 'tel' | 'piva';
      where: { deletedAt: null; companyId: null; email?: string; tel?: string; piva?: string };
    }> = [];
    if (company.email) {
      cascade.push({
        via: 'email',
        where: {
          deletedAt: null,
          companyId: null,
          email: company.email.toLowerCase(),
        },
      });
    }
    if (company.telefono) {
      cascade.push({
        via: 'tel',
        where: {
          deletedAt: null,
          companyId: null,
          tel: normalizePhone(company.telefono),
        },
      });
    }
    cascade.push({
      via: 'piva',
      where: {
        deletedAt: null,
        companyId: null,
        piva: company.partitaIva,
      },
    });

    for (const step of cascade) {
      const found = await prisma.crmContact.findFirst({
        where: step.where,
        orderBy: { updatedAt: 'desc' },
        select: { id: true, status: true },
      });
      if (found) {
        const data: Prisma.CrmContactUncheckedUpdateInput = {
          companyId,
          // Auto-promote a S7 solo se il contatto era pre-iscrizione
          // (S0..S6). Se era già più avanti (es. ri-iscrizione), preserva.
          status: isPreIscrizione(found.status) ? STATUS_S7 : found.status,
          iscrizioneComp: true,
          iscrizioneAt: new Date(),
          platStatus: 'INATTIVO',
        };
        // Arricchimento conservativo: se la company è arrivata via referral,
        // marca la fonte come REFERRAL. Altrimenti NON tocchiamo `fonte` per
        // preservare lo storico del lead (es. CSV_INIZIALE).
        if (company.referenteId) {
          data.fonte = CrmFonteAcquisizione.REFERRAL;
        }
        await prisma.crmContact.update({
          where: { id: found.id },
          data,
        });
        return { matched: true, contactId: found.id, via: step.via };
      }
    }
    return { matched: false };
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

