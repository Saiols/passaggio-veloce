import 'server-only';
import { prisma, Prisma } from '@pv/db';
import { getPayment } from '@/lib/providers/payment';

const BATCH_SIZE = 20;

export type ProcessPayoutsResult = {
  processed: number;
  succeeded: number;
  failed: number;
};

const payoutWithWallet = Prisma.validator<Prisma.PayoutDefaultArgs>()({
  include: {
    wallet: { include: { company: { select: { id: true, iban: true } } } },
  },
});

type PayoutWithWallet = Prisma.PayoutGetPayload<typeof payoutWithWallet>;

export async function processPayouts(): Promise<ProcessPayoutsResult> {
  const payouts: PayoutWithWallet[] = await prisma.payout.findMany({
    where: { stato: 'RICHIESTO' },
    take: BATCH_SIZE,
    orderBy: { richiestoAt: 'asc' },
    ...payoutWithWallet,
  });

  let succeeded = 0;
  let failed = 0;
  const payment = getPayment();

  for (const payout of payouts) {
    await prisma.payout.update({
      where: { id: payout.id },
      data: { stato: 'IN_LAVORAZIONE' },
    });

    const iban = payout.wallet.company.iban ?? '';
    if (!iban) {
      await prisma.payout.update({
        where: { id: payout.id },
        data: {
          stato: 'FALLITO',
          errorMessage: 'IBAN mancante',
          fallitoAt: new Date(),
        },
      });
      failed++;
      continue;
    }

    const result = await payment.executePayout({
      payoutId: payout.id,
      importoCent: payout.importoCent,
      iban,
    });

    if (result.ok) {
      await prisma.$transaction(async (tx) => {
        const wallet = await tx.wallet.update({
          where: { id: payout.walletId },
          data: { saldoCent: { decrement: payout.importoCent } },
        });
        await tx.transazioneWallet.create({
          data: {
            walletId: wallet.id,
            tipo: payout.automatico ? 'PAYOUT_AUTOMATICO' : 'PAYOUT_MANUALE',
            importoCent: -payout.importoCent,
            saldoPostCent: wallet.saldoCent,
            payoutId: payout.id,
          },
        });
        await tx.payout.update({
          where: { id: payout.id },
          data: {
            stato: 'ESEGUITO',
            providerRef: result.providerRef,
            eseguitoAt: new Date(),
            errorMessage: null,
          },
        });
      });
      succeeded++;
    } else {
      await prisma.payout.update({
        where: { id: payout.id },
        data: {
          stato: 'FALLITO',
          errorMessage: result.error,
          fallitoAt: new Date(),
        },
      });
      failed++;
    }
  }

  return { processed: payouts.length, succeeded, failed };
}
