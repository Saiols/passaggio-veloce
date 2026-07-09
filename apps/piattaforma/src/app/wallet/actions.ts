'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { isOwner } from '@/lib/auth/permissions';
import { getOperatingSede, getSedeRole } from '@/lib/auth/session-context';
import { prisma } from '@pv/db';
import { canEditSedeSettings } from '@/lib/sedi/scope';
import { WALLET, validatePayoutThresholdCent } from '@/lib/wallet/config';
import { eseguiPayoutImmediato } from '@/lib/wallet/payout-exec';

export type PayoutResult = { ok: true } | { ok: false; error: string } | { ok: false; requireMandato: true };

/**
 * Richiesta payout ISTANTANEA: il payout viene eseguito subito (saldo azzerato,
 * documento broker generato, payout ESEGUITO), senza passare dall'approvazione
 * admin né dal job. Copre entrambi i wallet incassabili: la sede operativa
 * (compensi pratiche) e la madre (commissioni affiliazione).
 */
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
  if (!session.user.companyId) return { ok: false, error: 'Azienda non associata' };

  // Wallet incassabili: sede operativa (pratiche) + madre (affiliazione,
  // riservata al proprietario — R5).
  const sede = await getOperatingSede();
  if (!sede) {
    return { ok: false, error: 'Seleziona una sede per richiedere il payout' };
  }
  // Il payout è un'operazione finanziaria della sede: la chiede il titolare o
  // l'admin di quella sede, non un operatore. Stesso predicato usato per la
  // soglia payout (updatePayoutThresholdAction, poco più sotto).
  const role = await getSedeRole(sede.id);
  if (!canEditSedeSettings(role)) {
    return { ok: false, error: 'Non hai i permessi per richiedere il payout di questa sede' };
  }

  const includeAffiliazione = isOwner(session.user.role);
  const [walletSede, walletMadre] = await Promise.all([
    prisma.wallet.findUnique({
      where: { sedeId: sede.id },
      select: { id: true, saldoCent: true },
    }),
    includeAffiliazione
      ? prisma.wallet.findUnique({
          where: { companyId: session.user.companyId },
          select: { id: true, saldoCent: true },
        })
      : null,
  ]);

  const wallets = [walletSede, walletMadre].filter(
    (w): w is { id: string; saldoCent: number } => w != null,
  );
  if (wallets.length === 0) return { ok: false, error: 'Wallet non trovato' };

  const eleggibili = wallets.filter((w) => w.saldoCent >= WALLET.MIN_PAYOUT_CENT);
  if (eleggibili.length === 0) {
    return {
      ok: false,
      error: `Saldo sotto la soglia minima di ${WALLET.MIN_PAYOUT_CENT / 100}€`,
    };
  }

  // Gate mandato fatturazione: alla PRIMA richiesta payout serve il contratto firmato.
  const mandato = await prisma.mandatoFatturazione.findUnique({
    where: { companyId: session.user.companyId },
    select: { id: true },
  });
  if (!mandato) return { ok: false, requireMandato: true };

  let eseguiti = 0;
  let ultimoErrore: string | null = null;
  for (const w of eleggibili) {
    const res = await eseguiPayoutImmediato(w.id, { automatico: false });
    if (res.ok) eseguiti++;
    else ultimoErrore = res.error;
  }

  if (eseguiti === 0) {
    return { ok: false, error: ultimoErrore ?? 'Payout non riuscito' };
  }

  revalidatePath('/wallet');
  return { ok: true };
}

export type UpdatePayoutThresholdResult =
  | { ok: true }
  | { ok: false; error: string };

/**
 * Aggiorna la soglia auto-payout per la propria company. Consentito al
 * proprietario (ADMIN_AZIENDA) e all'admin della sede operativa (ADMIN_SEDE).
 */
export async function updatePayoutThresholdAction(
  thresholdCent: number,
): Promise<UpdatePayoutThresholdResult> {
  const sede = await getOperatingSede();
  if (!sede) return { ok: false, error: 'Seleziona una sede per modificarne la soglia' };
  const role = await getSedeRole(sede.id);
  if (!canEditSedeSettings(role)) {
    return { ok: false, error: 'Non hai i permessi per modificare la soglia di questa sede' };
  }
  const valid = validatePayoutThresholdCent(thresholdCent);
  if (valid === null) {
    return {
      ok: false,
      error: `Valore fuori range: deve essere tra ${WALLET.AUTO_PAYOUT_MIN_CENT / 100}€ e ${WALLET.AUTO_PAYOUT_MAX_CENT / 100}€`,
    };
  }

  await prisma.sede.update({
    where: { id: sede.id },
    data: { payoutThresholdCent: valid },
  });

  revalidatePath('/wallet');
  return { ok: true };
}
