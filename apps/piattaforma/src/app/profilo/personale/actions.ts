'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { prisma } from '@pv/db';

export type UpdateOwnProfileResult =
  | { ok: true }
  | { ok: false; error: string };

/**
 * Modifica i dati personali del proprio User account (item 04 release
 * 2026-05). Funziona per qualsiasi ruolo. Email scope-company:
 * la nuova email non deve collidere con altri user nella stessa azienda.
 */
export async function updateOwnProfileAction(
  email: string,
  nome: string,
  cognome: string,
  codiceFiscale: string,
): Promise<UpdateOwnProfileResult> {
  const session = await auth();
  if (!session?.user?.id) redirect('/login');
  const userId = session.user.id;

  const me = await prisma.user.findUnique({ where: { id: userId } });
  if (!me) return { ok: false, error: 'Account non trovato' };

  const emailLower = email.toLowerCase().trim();
  if (!emailLower || !/^[^@]+@[^@]+\.[^@]+$/.test(emailLower)) {
    return { ok: false, error: 'Email non valida' };
  }
  if (!nome.trim() || !cognome.trim()) {
    return { ok: false, error: 'Nome e cognome obbligatori' };
  }

  if (emailLower !== me.email) {
    const conflict = await prisma.user.findFirst({
      where: {
        email: emailLower,
        companyId: me.companyId,
        NOT: { id: userId },
      },
    });
    if (conflict) {
      return {
        ok: false,
        error: me.companyId
          ? 'Esiste già un altro utente con questa email nella tua azienda'
          : 'Esiste già un altro account amministrativo con questa email',
      };
    }
  }

  await prisma.user.update({
    where: { id: userId },
    data: {
      email: emailLower,
      nome: nome.trim(),
      cognome: cognome.trim(),
      codiceFiscale: codiceFiscale.trim() || null,
    },
  });

  revalidatePath('/profilo');
  revalidatePath('/profilo/personale');
  return { ok: true };
}
