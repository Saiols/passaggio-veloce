'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { prisma } from '@pv/db';

const MIN_PAYOUT_CENT = 50_000;

export type PayoutResult = { ok: true } | { ok: false; error: string };

export async function richiediPayoutAction(): Promise<PayoutResult> {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if (session.user.companyType !== 'DEALER') {
    return { ok: false, error: 'Solo i dealer possono richiedere payout' };
  }
  const companyId = session.user.companyId!;

  const wallet = await prisma.wallet.findUnique({ where: { companyId } });
  if (!wallet) return { ok: false, error: 'Wallet non trovato' };
  if (wallet.saldoCent < MIN_PAYOUT_CENT) {
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
