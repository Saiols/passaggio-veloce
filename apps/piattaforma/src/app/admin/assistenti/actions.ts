'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { prisma } from '@pv/db';
import { hashPassword } from '@/lib/auth/password';
import { isAdminPiattaforma } from '@/lib/auth/permissions';

export type CreateAssistenteResult = { ok: true } | { ok: false; error: string };

/**
 * Crea un utente con ruolo ASSISTENTE. Riservato a ADMIN_PIATTAFORMA
 * (l'assistente non si auto-registra, e nessun altro ruolo può crearlo).
 * L'utente è ACTIVE da subito, email auto-verificata, nessuna company
 * associata (l'assistente è utente di piattaforma, non di azienda).
 */
export async function createAssistenteAction(
  email: string,
  nome: string,
  cognome: string,
  password: string,
): Promise<CreateAssistenteResult> {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if (!isAdminPiattaforma(session.user.role)) {
    return {
      ok: false,
      error: 'Solo Admin Piattaforma può creare account assistente',
    };
  }

  const emailLower = email.toLowerCase().trim();
  if (!emailLower || !/^[^@]+@[^@]+\.[^@]+$/.test(emailLower)) {
    return { ok: false, error: 'Email non valida' };
  }
  if (!nome.trim() || !cognome.trim()) {
    return { ok: false, error: 'Nome e cognome obbligatori' };
  }
  if (!password || password.length < 8) {
    return { ok: false, error: 'Password troppo corta (min 8 caratteri)' };
  }
  if (!/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/[0-9]/.test(password)) {
    return { ok: false, error: 'Password deve contenere maiuscola, minuscola e numero' };
  }

  const existing = await prisma.user.findUnique({ where: { email: emailLower } });
  if (existing) return { ok: false, error: 'Esiste già un utente con questa email' };

  const passwordHash = await hashPassword(password);
  await prisma.user.create({
    data: {
      email: emailLower,
      passwordHash,
      nome: nome.trim(),
      cognome: cognome.trim(),
      role: 'ASSISTENTE',
      status: 'ACTIVE',
      emailVerifiedAt: new Date(),
      companyId: null,
    },
  });

  revalidatePath('/admin/assistenti');
  return { ok: true };
}
