'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { prisma } from '@pv/db';
import { canViewAggregatedFinancials } from '@/lib/auth/permissions';

const NOTE_SCHEMA = z.string().trim().max(1000).optional();

type Result = { ok: true } | { ok: false; error: string };

/**
 * Approva una commissione DA_REVISIONARE: la promuove ad ACCREDITATA e
 * popola wallet + transazione. Se la commissione era già ACCREDITATA o
 * ANNULLATA, no-op.
 */
export async function approveCommissioneAction(
  commissioneId: string,
  noteRaw?: string,
): Promise<Result> {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if (!canViewAggregatedFinancials(session.user.role)) {
    return { ok: false, error: 'Non autorizzato' };
  }
  const noteParsed = NOTE_SCHEMA.safeParse(noteRaw);
  if (!noteParsed.success) return { ok: false, error: 'Nota non valida' };

  try {
    await prisma.$transaction(async (tx) => {
      const commissione = await tx.commissioneAffiliazione.findUnique({
        where: { id: commissioneId },
        select: {
          id: true,
          stato: true,
          referenteId: true,
          praticaId: true,
          importoNettoCent: true,
        },
      });
      if (!commissione) throw new Error('Commissione non trovata');
      if (commissione.stato !== 'DA_REVISIONARE') {
        throw new Error(`Stato non valido: ${commissione.stato}`);
      }

      const wallet = await tx.wallet.upsert({
        where: { companyId: commissione.referenteId },
        update: {},
        create: { companyId: commissione.referenteId, saldoCent: 0 },
      });
      const nuovoSaldo = wallet.saldoCent + commissione.importoNettoCent;

      const transazione = await tx.transazioneWallet.create({
        data: {
          walletId: wallet.id,
          tipo: 'CREDITO_AFFILIAZIONE',
          importoCent: commissione.importoNettoCent,
          saldoPostCent: nuovoSaldo,
          praticaId: commissione.praticaId,
        },
      });
      await tx.wallet.update({
        where: { id: wallet.id },
        data: { saldoCent: nuovoSaldo },
      });

      await tx.commissioneAffiliazione.update({
        where: { id: commissioneId },
        data: {
          stato: 'ACCREDITATA',
          transazioneWalletId: transazione.id,
          reviewedAt: new Date(),
          reviewedById: session.user!.id,
          reviewNotes: noteParsed.data || null,
        },
      });
    });
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }

  revalidatePath('/admin/affiliazioni/sospette');
  revalidatePath('/admin/affiliazioni');
  return { ok: true };
}

/**
 * Rifiuta una commissione DA_REVISIONARE: la promuove ad ANNULLATA, niente
 * wallet credit. La commissione resta nel DB per audit.
 */
export async function rejectCommissioneAction(
  commissioneId: string,
  noteRaw?: string,
): Promise<Result> {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if (!canViewAggregatedFinancials(session.user.role)) {
    return { ok: false, error: 'Non autorizzato' };
  }
  const noteParsed = NOTE_SCHEMA.safeParse(noteRaw);
  if (!noteParsed.success) return { ok: false, error: 'Nota non valida' };

  const commissione = await prisma.commissioneAffiliazione.findUnique({
    where: { id: commissioneId },
    select: { id: true, stato: true },
  });
  if (!commissione) return { ok: false, error: 'Commissione non trovata' };
  if (commissione.stato !== 'DA_REVISIONARE') {
    return { ok: false, error: `Stato non valido: ${commissione.stato}` };
  }

  await prisma.commissioneAffiliazione.update({
    where: { id: commissioneId },
    data: {
      stato: 'ANNULLATA',
      reviewedAt: new Date(),
      reviewedById: session.user.id,
      reviewNotes: noteParsed.data || null,
    },
  });

  revalidatePath('/admin/affiliazioni/sospette');
  revalidatePath('/admin/affiliazioni');
  return { ok: true };
}
