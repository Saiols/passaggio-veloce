'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { prisma } from '@pv/db';
import { WALLET } from '@/lib/wallet/config';

export type PayoutResult = { ok: true } | { ok: false; error: string };

export async function richiediPayoutAction(): Promise<PayoutResult> {
  const session = await auth();
  if (!session?.user) redirect('/login');
  // D-05: stesse soglie e stesso flusso payout per broker e agenzie.
  if (
    session.user.companyType !== 'DEALER' &&
    session.user.companyType !== 'AGENZIA'
  ) {
    return { ok: false, error: 'Payout disponibile solo per broker e agenzie' };
  }
  const companyId = session.user.companyId!;

  const wallet = await prisma.wallet.findUnique({ where: { companyId } });
  if (!wallet) return { ok: false, error: 'Wallet non trovato' };
  if (wallet.saldoCent < WALLET.MIN_PAYOUT_CENT) {
    return { ok: false, error: 'Saldo sotto la soglia minima di 500€' };
  }

  const inflight = await prisma.payout.findFirst({
    where: { walletId: wallet.id, stato: { in: ['RICHIESTO', 'IN_LAVORAZIONE'] } },
  });
  if (inflight) return { ok: false, error: 'Payout già in corso, attendi' };

  await prisma.payout.create({
    data: {
      walletId: wallet.id,
      importoCent: wallet.saldoCent,
      stato: 'RICHIESTO',
      automatico: false,
    },
  });

  revalidatePath('/wallet');
  return { ok: true };
}
