import 'server-only';
import { prisma } from '@pv/db';
import { sendNotification } from '@/lib/notifiche';

const MONTH_LABELS = [
  'Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno',
  'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre',
];

/**
 * N25 — recap mensile affiliazione (FASE 13.4).
 *
 * Per ogni Company che ha ricevuto almeno 1 commissione ACCREDITATA il mese
 * precedente, invia una mail riassuntiva con totale, num commissioni, num
 * referral attivi e saldo wallet attuale. Manda 1 mail all'admin di ogni
 * company referente (primo ADMIN_AZIENDA ACTIVE).
 *
 * Trigger schedulato: cron Vercel `0 9 1 * *` (1° del mese alle 9:00).
 *
 * Idempotenza: il recap è puramente informativo, può essere triggerato più
 * volte senza side-effect (al massimo l'utente riceve due mail uguali).
 */
export async function affiliationMonthlyRecap(referenceDate: Date = new Date()): Promise<{
  scanned: number;
  notified: number;
}> {
  // Mese precedente rispetto a referenceDate
  const targetMonth = referenceDate.getMonth() === 0 ? 11 : referenceDate.getMonth() - 1;
  const targetYear =
    referenceDate.getMonth() === 0
      ? referenceDate.getFullYear() - 1
      : referenceDate.getFullYear();

  const monthStart = new Date(targetYear, targetMonth, 1, 0, 0, 0, 0);
  const monthEnd = new Date(targetYear, targetMonth + 1, 1, 0, 0, 0, 0);
  const meseLabel = `${MONTH_LABELS[targetMonth]} ${targetYear}`;

  // Aggrega commissioni ACCREDITATA del mese per referenteId
  const grouped = await prisma.commissioneAffiliazione.groupBy({
    by: ['referenteId'],
    where: {
      stato: 'ACCREDITATA',
      createdAt: { gte: monthStart, lt: monthEnd },
    },
    _count: { _all: true },
    _sum: { importoNettoCent: true },
  });

  let notified = 0;

  for (const g of grouped) {
    const referenteId = g.referenteId;
    const numCommissioni = g._count._all;
    const totaleAccreditatoCent = g._sum.importoNettoCent ?? 0;

    // Recupera company + admin user + saldo wallet + count referral attivi
    const [company, admin, wallet, referralAttivi] = await Promise.all([
      prisma.company.findUnique({
        where: { id: referenteId },
        select: {
          id: true,
          ragioneSociale: true,
          deletedAt: true,
          suspendedAt: true,
        },
      }),
      prisma.user.findFirst({
        where: {
          companyId: referenteId,
          role: 'ADMIN_AZIENDA',
          status: 'ACTIVE',
          deletedAt: null,
        },
        orderBy: { createdAt: 'asc' },
        select: { id: true, email: true, nome: true },
      }),
      prisma.wallet.findUnique({
        where: { companyId: referenteId },
        select: { saldoCent: true },
      }),
      prisma.commissioneAffiliazione
        .groupBy({
          by: ['praticaId'],
          where: {
            referenteId,
            stato: 'ACCREDITATA',
          },
        })
        .then((rows) => rows.length),
    ]);

    if (!company || company.deletedAt || company.suspendedAt) continue;
    if (!admin) continue;

    await sendNotification({
      tipo: 'N25_MONTHLY_AFFILIATION_RECAP',
      target: {
        email: admin.email,
        userId: admin.id,
        companyId: referenteId,
      },
      payload: {
        nomeReferente: admin.nome,
        meseLabel,
        numCommissioni,
        totaleAccreditatoCent,
        numReferralAttivi: referralAttivi,
        saldoWalletCent: wallet?.saldoCent ?? 0,
      },
    }).catch(() => undefined);

    notified += 1;
  }

  return { scanned: grouped.length, notified };
}
