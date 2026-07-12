'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { auth, unstable_update } from '@/auth';
import { prisma } from '@pv/db';
import { hashPassword, verifyPassword, validatePasswordPolicy } from '@/lib/auth/password';

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

  // Allinea subito la sessione (JWT) al nuovo recapito/nome, così header e menu
  // si aggiornano senza dover ri-loggare. Best-effort: se fallisce i dati sono
  // comunque salvati e si allineano al prossimo login.
  await unstable_update({ user: { email: emailLower } }).catch(() => undefined);

  revalidatePath('/profilo');
  revalidatePath('/profilo/personale');
  return { ok: true };
}

export type ChangeOwnPasswordResult = { ok: true } | { ok: false; error: string };

/**
 * Cambio password self-service: richiede la password attuale (chi ha la
 * sessione aperta su un PC altrui non deve poter cambiare le credenziali).
 * Chi non ricorda la password attuale passa dal recupero via email
 * (/reset-password).
 */
export async function changeOwnPasswordAction(
  currentPassword: string,
  newPassword: string,
): Promise<ChangeOwnPasswordResult> {
  const session = await auth();
  if (!session?.user?.id) redirect('/login');

  const me = await prisma.user.findUnique({ where: { id: session.user.id } });
  if (!me) return { ok: false, error: 'Account non trovato' };

  if (!(await verifyPassword(currentPassword, me.passwordHash))) {
    return { ok: false, error: 'La password attuale non è corretta' };
  }

  const invalid = validatePasswordPolicy(newPassword);
  if (invalid) return { ok: false, error: invalid };

  if (await verifyPassword(newPassword, me.passwordHash)) {
    return { ok: false, error: 'La nuova password deve essere diversa da quella attuale' };
  }

  const passwordHash = await hashPassword(newPassword);

  // Stessa semantica del reset via email (confirmPasswordResetAction): la
  // stessa persona può avere più User con la stessa email (uno per azienda).
  // La password li segue tutti, altrimenti la vecchia resterebbe valida per
  // entrare — cambiarla su un solo record darebbe una falsa sicurezza.
  await prisma.user.updateMany({
    where: { email: me.email, deletedAt: null },
    data: { passwordHash },
  });

  return { ok: true };
}
