'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { getOperatingSede } from '@/lib/auth/session-context';
import { prisma } from '@pv/db';
import { WALLET, validatePayoutThresholdCent } from '@/lib/wallet/config';

export type PayoutResult = { ok: true } | { ok: false; error: string } | { ok: false; requireMandato: true };

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
  // Multi-sede: payout dal wallet della sede operativa.
  const sede = await getOperatingSede();
  if (!sede) return { ok: false, error: 'Seleziona una sede per richiedere il payout' };

  const wallet = await prisma.wallet.findUnique({ where: { sedeId: sede.id } });
  if (!wallet) return { ok: false, error: 'Wallet non trovato' };
  if (wallet.saldoCent < WALLET.MIN_PAYOUT_CENT) {
    return { ok: false, error: 'Saldo sotto la soglia minima di 500€' };
  }

  const inflight = await prisma.payout.findFirst({
    where: { walletId: wallet.id, stato: { in: ['RICHIESTO', 'IN_LAVORAZIONE'] } },
  });
  if (inflight) return { ok: false, error: 'Payout già in corso, attendi' };

  // Gate mandato fatturazione: alla PRIMA richiesta payout serve il contratto firmato.
  if (!session.user.companyId) return { ok: false, error: 'Azienda non associata' };
  const mandato = await prisma.mandatoFatturazione.findUnique({
    where: { companyId: session.user.companyId },
    select: { id: true },
  });
  if (!mandato) return { ok: false, requireMandato: true };

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

export type UpdatePayoutThresholdResult =
  | { ok: true }
  | { ok: false; error: string };

/**
 * Aggiorna la soglia auto-payout per la propria company. Riservato a
 * ADMIN_AZIENDA (item 12 release 2026-05).
 */
export async function updatePayoutThresholdAction(
  thresholdCent: number,
): Promise<UpdatePayoutThresholdResult> {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if (session.user.role !== 'ADMIN_AZIENDA') {
    return {
      ok: false,
      error: "Solo l'admin azienda può modificare la soglia",
    };
  }
  const valid = validatePayoutThresholdCent(thresholdCent);
  if (valid === null) {
    return {
      ok: false,
      error: `Valore fuori range: deve essere tra ${WALLET.AUTO_PAYOUT_MIN_CENT / 100}€ e ${WALLET.AUTO_PAYOUT_MAX_CENT / 100}€`,
    };
  }

  // Multi-sede: la soglia auto-payout è per sede operativa.
  const sede = await getOperatingSede();
  if (!sede) return { ok: false, error: 'Seleziona una sede per modificarne la soglia' };

  await prisma.sede.update({
    where: { id: sede.id },
    data: { payoutThresholdCent: valid },
  });

  revalidatePath('/wallet');
  return { ok: true };
}
