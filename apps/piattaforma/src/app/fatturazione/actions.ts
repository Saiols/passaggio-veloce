'use server';

import { revalidatePath } from 'next/cache';
import { auth } from '@/auth';
import { prisma } from '@pv/db';

export type SegnaTrasmessoResult = { ok: true } | { ok: false; error: string };

/**
 * L'admin di PV segna un documento fiscale come "gestito dal commercialista":
 * il commercialista scarica PDF/XML ed emette il documento allo SdI in autonomia
 * (fuori piattaforma). Questo NON trasmette nulla — è solo un flag di tracciamento
 * interno per sapere cosa è già stato emesso vs in attesa. Consentito solo
 * all'amministratore di piattaforma; idempotente.
 *
 * NB: le colonne DB restano `trasmessoSdiAt`/`trasmessoSdiBy` (nessuna migration);
 * il loro significato è "segnato come gestito dal commercialista".
 */
export async function segnaTrasmessoSdiAction(documentoId: string): Promise<SegnaTrasmessoResult> {
  const session = await auth();
  if (!session?.user) {
    return { ok: false, error: 'Non autorizzato.' };
  }
  if (session.user.role !== 'ADMIN_PIATTAFORMA') {
    return { ok: false, error: 'Operazione consentita solo all’amministratore.' };
  }

  const doc = await prisma.documentoFiscale.findUnique({
    where: { id: documentoId },
    select: { id: true, fatturaPaTipo: true, trasmessoSdiAt: true },
  });
  if (!doc) {
    return { ok: false, error: 'Documento non trovato.' };
  }
  if (!doc.fatturaPaTipo) {
    return { ok: false, error: 'Documento senza emissione fiscale elettronica.' };
  }
  if (doc.trasmessoSdiAt) {
    return { ok: true }; // idempotente: già segnato come gestito
  }

  await prisma.documentoFiscale.update({
    where: { id: doc.id },
    data: { trasmessoSdiAt: new Date(), trasmessoSdiBy: session.user.id },
  });

  revalidatePath(`/fatturazione/${doc.id}`);
  revalidatePath('/fatturazione');
  revalidatePath('/admin/fatturazione');
  return { ok: true };
}
