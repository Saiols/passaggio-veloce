import 'server-only';
import { prisma } from '@pv/db';

export type TriggerAutoPayoutResult = { created: number };

/**
 * Cron payout: per ogni wallet, confronta il saldo con la soglia
 * configurata sulla company di appartenenza (item 12 release 2026-05).
 * Filtriamo lato applicazione anziche' lato DB per non duplicare la
 * regola: e' una query bottleneck periodica, non hot path.
 */
export async function triggerAutoPayout(): Promise<TriggerAutoPayoutResult> {
  const wallets = await prisma.wallet.findMany({
    select: {
      id: true,
      saldoCent: true,
      company: { select: { payoutThresholdCent: true } },
    },
  });

  let created = 0;
  for (const w of wallets) {
    const threshold = w.company.payoutThresholdCent;
    if (w.saldoCent < threshold) continue;

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
