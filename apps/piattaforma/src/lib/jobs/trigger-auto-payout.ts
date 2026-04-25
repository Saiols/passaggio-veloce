import 'server-only';
import { prisma } from '@pv/db';

const AUTO_PAYOUT_THRESHOLD_CENT = 100_000;

export type TriggerAutoPayoutResult = { created: number };

export async function triggerAutoPayout(): Promise<TriggerAutoPayoutResult> {
  const wallets = await prisma.wallet.findMany({
    where: { saldoCent: { gte: AUTO_PAYOUT_THRESHOLD_CENT } },
    select: { id: true, saldoCent: true },
  });

  let created = 0;
  for (const w of wallets) {
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
