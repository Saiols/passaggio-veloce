import 'server-only';
import { prisma } from '@pv/db';
import { settlePayout } from '@/lib/wallet/payout-exec';

const BATCH_SIZE = 20;

export type ProcessPayoutsResult = {
  processed: number;
  succeeded: number;
  failed: number;
};

/**
 * Job payout (path AUTO): prende i Payout RICHIESTO (creati da
 * `triggerAutoPayout`) e li salda uno per uno tramite `settlePayout` — stesso
 * motore del payout istantaneo (provider + safeguard + documento broker).
 * Come il payout manuale, opera anche in mock (Strada B): il safeguard sui soldi
 * reali vive nel provider dentro `settlePayout`.
 */
export async function processPayouts(): Promise<ProcessPayoutsResult> {
  const payouts = await prisma.payout.findMany({
    where: { stato: 'RICHIESTO' },
    take: BATCH_SIZE,
    orderBy: { richiestoAt: 'asc' },
    select: { id: true },
  });

  let succeeded = 0;
  let failed = 0;

  for (const payout of payouts) {
    await prisma.payout.update({
      where: { id: payout.id },
      data: { stato: 'IN_LAVORAZIONE' },
    });
    const res = await settlePayout(payout.id);
    if (res.ok) succeeded++;
    else failed++;
  }

  return { processed: payouts.length, succeeded, failed };
}
