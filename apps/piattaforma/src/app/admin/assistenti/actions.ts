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

  // Scope-platform: blocchiamo solo conflitti con altri admin platform o
  // assistenti (companyId=null). La stessa email puo' esistere come admin
  // di azienda dealer/agenzia senza conflitti (item 14 release 2026-05).
  const existing = await prisma.user.findFirst({
    where: { email: emailLower, companyId: null },
  });
  if (existing) {
    return {
      ok: false,
      error: 'Esiste già un assistente o admin con questa email',
    };
  }

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

// ============================================================
// MODIFICA + RESET PASSWORD ASSISTENTE (item 14 release 2026-05)
// ============================================================

function generateTempPassword(): string {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower = 'abcdefghijkmnpqrstuvwxyz';
  const digits = '23456789';
  const all = upper + lower + digits;
  let pwd = '';
  pwd += upper[Math.floor(Math.random() * upper.length)];
  pwd += lower[Math.floor(Math.random() * lower.length)];
  pwd += digits[Math.floor(Math.random() * digits.length)];
  for (let i = 0; i < 7; i++) {
    pwd += all[Math.floor(Math.random() * all.length)];
  }
  return pwd
    .split('')
    .sort(() => Math.random() - 0.5)
    .join('');
}

export type UpdateAssistenteResult =
  | { ok: true }
  | { ok: false; error: string };

export async function updateAssistenteAction(
  userId: string,
  email: string,
  nome: string,
  cognome: string,
): Promise<UpdateAssistenteResult> {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if (!isAdminPiattaforma(session.user.role)) {
    return {
      ok: false,
      error: 'Solo Admin Piattaforma può modificare gli assistenti',
    };
  }

  const target = await prisma.user.findUnique({ where: { id: userId } });
  if (!target || target.role !== 'ASSISTENTE') {
    return { ok: false, error: 'Assistente non trovato' };
  }

  const emailLower = email.toLowerCase().trim();
  if (!emailLower || !/^[^@]+@[^@]+\.[^@]+$/.test(emailLower)) {
    return { ok: false, error: 'Email non valida' };
  }
  if (!nome.trim() || !cognome.trim()) {
    return { ok: false, error: 'Nome e cognome obbligatori' };
  }

  if (emailLower !== target.email) {
    const conflict = await prisma.user.findFirst({
      where: { email: emailLower, companyId: null, NOT: { id: userId } },
    });
    if (conflict) {
      return {
        ok: false,
        error: 'Esiste già un altro assistente o admin con questa email',
      };
    }
  }

  await prisma.user.update({
    where: { id: userId },
    data: {
      email: emailLower,
      nome: nome.trim(),
      cognome: cognome.trim(),
    },
  });

  revalidatePath('/admin/assistenti');
  revalidatePath(`/admin/assistenti/${userId}/edit`);
  return { ok: true };
}

export type ResetAssistentePasswordResult =
  | { ok: true; newPassword: string }
  | { ok: false; error: string };

export async function resetAssistentePasswordAction(
  userId: string,
): Promise<ResetAssistentePasswordResult> {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if (!isAdminPiattaforma(session.user.role)) {
    return {
      ok: false,
      error: 'Solo Admin Piattaforma può resettare le password',
    };
  }

  const target = await prisma.user.findUnique({ where: { id: userId } });
  if (!target || target.role !== 'ASSISTENTE') {
    return { ok: false, error: 'Assistente non trovato' };
  }

  const newPassword = generateTempPassword();
  const passwordHash = await hashPassword(newPassword);

  await prisma.user.update({
    where: { id: userId },
    data: { passwordHash },
  });

  revalidatePath(`/admin/assistenti/${userId}/edit`);
  return { ok: true, newPassword };
}
