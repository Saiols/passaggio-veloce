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

      // Compare-and-set: promuove DA_REVISIONARE→ACCREDITATA solo se nessun'altra
      // transazione concorrente ha già vinto la corsa. Senza questo gate due
      // approvazioni simultanee superano entrambe il controllo di stato sopra
      // (READ COMMITTED) e accreditano il wallet due volte. Le review fields si
      // scrivono qui, atomicamente con la transizione (stesso pattern del CAS
      // PROCESSATA→FIRMATA in firma-engine.ts).
      const claimed = await tx.commissioneAffiliazione.updateMany({
        where: { id: commissioneId, stato: 'DA_REVISIONARE' },
        data: {
          stato: 'ACCREDITATA',
          reviewedAt: new Date(),
          reviewedById: session.user!.id,
          reviewNotes: noteParsed.data || null,
        },
      });
      // Un'altra approvazione concorrente ha già gestito la commissione: niente
      // secondo accredito. Esito benigno (la commissione è già ACCREDITATA).
      if (claimed.count !== 1) return;

      const wallet = await tx.wallet.upsert({
        where: { companyId: commissione.referenteId },
        update: {},
        create: { companyId: commissione.referenteId, saldoCent: 0 },
      });
      // Incremento atomico (no leggi-poi-scrivi): il saldo post proviene dal
      // valore restituito dall'UPDATE.
      const w = await tx.wallet.update({
        where: { id: wallet.id },
        data: { saldoCent: { increment: commissione.importoNettoCent } },
      });

      const transazione = await tx.transazioneWallet.create({
        data: {
          walletId: wallet.id,
          tipo: 'CREDITO_AFFILIAZIONE',
          importoCent: commissione.importoNettoCent,
          saldoPostCent: w.saldoCent,
          praticaId: commissione.praticaId,
        },
      });

      // Aggancia la transazione appena creata alla commissione già promossa dal
      // CAS (le altre review fields sono state scritte nell'updateMany sopra).
      await tx.commissioneAffiliazione.update({
        where: { id: commissioneId },
        data: { transazioneWalletId: transazione.id },
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
