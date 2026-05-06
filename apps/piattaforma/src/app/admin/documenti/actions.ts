'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { prisma } from '@pv/db';
import { isAdminOrAssistente } from '@/lib/auth/permissions';

type Result = { ok: true } | { ok: false; error: string };

/**
 * Override admin del gating documentale: forza lo stato a OVERRIDDEN
 * (equivalente a PASSED ma tracciato come decisione manuale).
 *
 * Il record `Documento` salva `gatingOverrideById` + `gatingOverrideAt`
 * per audit GDPR e attribuzione decisioni.
 */
export async function overrideGatingAction(
  documentoId: string,
): Promise<Result> {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if (!isAdminOrAssistente(session.user.role)) {
    return { ok: false, error: 'Operazione riservata ad admin/assistente' };
  }

  const doc = await prisma.documento.findUnique({
    where: { id: documentoId },
    select: { id: true, praticaId: true, gatingStato: true },
  });
  if (!doc) return { ok: false, error: 'Documento non trovato' };

  await prisma.documento.update({
    where: { id: documentoId },
    data: {
      gatingStato: 'OVERRIDDEN',
      gatingOverrideById: session.user.id,
      gatingOverrideAt: new Date(),
      gatingError: null,
    },
  });

  if (doc.praticaId) {
    revalidatePath(`/pratiche/${doc.praticaId}`);
    revalidatePath(`/inbox/${doc.praticaId}`);
  }
  return { ok: true };
}
