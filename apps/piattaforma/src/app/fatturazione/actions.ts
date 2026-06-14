'use server';

import { revalidatePath } from 'next/cache';
import { auth } from '@/auth';
import { prisma } from '@pv/db';

export type SegnaTrasmessoResult = { ok: true } | { ok: false; error: string };

/**
 * FT-D: il broker segna come "trasmesso allo SDI" un proprio documento
 * (compenso intermediazione, DOC_BROKER). Operazione manuale finché la
 * trasmissione automatica SDI non è validata col commercialista (B1).
 * Consentita solo all'emittente del documento.
 */
export async function segnaTrasmessoSdiAction(documentoId: string): Promise<SegnaTrasmessoResult> {
  const session = await auth();
  if (!session?.user?.companyId) {
    return { ok: false, error: 'Non autorizzato.' };
  }

  const doc = await prisma.documentoFiscale.findUnique({
    where: { id: documentoId },
    select: { id: true, tipo: true, emittenteCompanyId: true, trasmessoSdiAt: true },
  });
  if (!doc) {
    return { ok: false, error: 'Documento non trovato.' };
  }
  if (doc.tipo !== 'DOC_BROKER' || doc.emittenteCompanyId !== session.user.companyId) {
    return { ok: false, error: 'Operazione non consentita su questo documento.' };
  }
  if (doc.trasmessoSdiAt) {
    return { ok: true }; // idempotente: già trasmesso
  }

  await prisma.documentoFiscale.update({
    where: { id: doc.id },
    data: { trasmessoSdiAt: new Date(), trasmessoSdiBy: session.user.id },
  });

  revalidatePath(`/fatturazione/${doc.id}`);
  revalidatePath('/fatturazione');
  return { ok: true };
}
