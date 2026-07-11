import 'server-only';
import { prisma } from '@pv/db';
import { hasNegativeCompanyWallet } from '@/lib/wallet/negative-wallet-guard';

export type TriggerAutoPayoutResult = { created: number };

/**
 * Cron payout: per ogni wallet, confronta il saldo con la soglia
 * configurata sulla company di appartenenza (item 12 release 2026-05).
 * Filtriamo lato applicazione anziche' lato DB per non duplicare la
 * regola: e' una query bottleneck periodica, non hot path.
 *
 * Rete di sicurezza periodica: l'innesco primario è real-time (vedi
 * `maybeAutoPayoutForWallet`, chiamato dopo gli accrediti). Come il payout
 * MANUALE, funziona anche in mock (Strada B): il safeguard sui soldi reali vive
 * nel provider dentro `settlePayout`, non qui.
 *
 * Clausola 5 dei Termini: questo path NON passa da `eseguiPayoutImmediato`
 * (crea il Payout direttamente, `processPayouts` lo salda via
 * `settlePayout`), quindi il guard sul saldo negativo aziendale va replicato
 * qui — altrimenti la rete di sicurezza periodica pagherebbe un wallet anche
 * quando un altro wallet della stessa azienda è in negativo, riaprendo lo
 * stesso buco chiuso in `eseguiPayoutImmediato`. Non c'è eccezione
 * `ignoraSoglia` qui: questo path serve solo l'auto-payout ordinario, mai la
 * liquidazione di cessazione (quella passa da `deleteCompanyAction`).
 */
export async function triggerAutoPayout(): Promise<TriggerAutoPayoutResult> {
  const wallets = await prisma.wallet.findMany({
    select: {
      id: true,
      saldoCent: true,
      companyId: true,
      // Multi-sede: soglia del wallet di sede (operativo) o della madre (affiliazione).
      sede: { select: { payoutThresholdCent: true, companyId: true } },
      company: { select: { payoutThresholdCent: true } },
    },
  });

  let created = 0;
  for (const w of wallets) {
    const threshold = w.sede?.payoutThresholdCent ?? w.company?.payoutThresholdCent ?? 100000;
    if (w.saldoCent < threshold) continue;

    const companyId = w.companyId ?? w.sede?.companyId ?? null;
    if (companyId && (await hasNegativeCompanyWallet(prisma, companyId))) continue;

    const inflight = await prisma.payout.findFirst({
      where: { walletId: w.id, stato: { in: ['RICHIESTO', 'IN_LAVORAZIONE'] } },
    });
    if (inflight) continue;

    await prisma.payout.create({
      data: {
        walletId: w.id,
        importoCent: w.saldoCent,
        stato: 'RICHIESTO',
        automatico: true,
      },
    });
    created++;
  }
  return { created };
}
