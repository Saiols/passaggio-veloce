'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { prisma } from '@pv/db';
import { generateSecureToken, expiresIn } from '@/lib/auth/tokens';
import { hashPassword } from '@/lib/auth/password';
import { getEmail } from '@/lib/providers/email';
import { env } from '@/env';

export type InviteResult =
  | { ok: true; demoLink?: string }
  | { ok: false; error: string };

export async function createInvitationAction(email: string): Promise<InviteResult> {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if (session.user.role !== 'ADMIN_AZIENDA') {
    return { ok: false, error: "Solo l'admin azienda può invitare utenti" };
  }
  const companyId = session.user.companyId!;
  const invitedById = session.user.id!;

  const emailLower = email.toLowerCase().trim();
  if (!emailLower || !/^[^@]+@[^@]+\.[^@]+$/.test(emailLower)) {
    return { ok: false, error: 'Email non valida' };
  }

  // Multi-tenancy: il blocco vale solo se l'email e' gia' usata IN QUESTA azienda
  // (item 07 release 2026-05). La stessa email puo' esistere in altre aziende.
  const existingUser = await prisma.user.findFirst({
    where: { email: emailLower, companyId },
  });
  if (existingUser) {
    return {
      ok: false,
      error: 'Esiste già un utente con questa email nella tua azienda',
    };
  }

  const existingPending = await prisma.invitation.findFirst({
    where: { email: emailLower, status: 'PENDING' },
  });
  if (existingPending) {
    return { ok: false, error: 'Esiste già un invito pending per questa email' };
  }

  const token = generateSecureToken();
  await prisma.invitation.create({
    data: {
      email: emailLower,
      token,
      role: 'UTENTE_AZIENDA',
      status: 'PENDING',
      companyId,
      invitedById,
      expiresAt: expiresIn(24 * 7),
    },
  });

  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { ragioneSociale: true },
  });

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
  const link = `${appUrl}/invito/${token}`;

  await getEmail().send({
    to: emailLower,
    subject: `Sei stato invitato in ${company?.ragioneSociale ?? 'Passaggio Veloce'}`,
    html: `
      <p>Ciao,</p>
      <p>Sei stato invitato a unirti a <strong>${company?.ragioneSociale ?? "un'azienda"}</strong> su Passaggio Veloce.</p>
      <p>Clicca qui per impostare la tua password e accedere (link valido 7 giorni):</p>
      <p><a href="${link}">${link}</a></p>
    `,
    text: `Invito Passaggio Veloce: ${link}`,
    tag: 'invitation',
  });

  revalidatePath('/team');
  return env.DEMO_MODE ? { ok: true, demoLink: link } : { ok: true };
}

export type AcceptInviteResult =
  | { ok: true }
  | { ok: false; error: string };

export async function acceptInvitationAction(
  token: string,
  nome: string,
  cognome: string,
  password: string,
): Promise<AcceptInviteResult> {
  if (!token) return { ok: false, error: 'Token mancante' };
  if (!nome.trim() || !cognome.trim()) {
    return { ok: false, error: 'Nome e cognome obbligatori' };
  }
  if (!password || password.length < 8) {
    return { ok: false, error: 'Password troppo corta (min 8)' };
  }
  if (!/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/[0-9]/.test(password)) {
    return { ok: false, error: 'Password deve avere maiuscola, minuscola e numero' };
  }

  const invitation = await prisma.invitation.findUnique({ where: { token } });
  if (!invitation) return { ok: false, error: 'Invito non trovato' };
  if (invitation.status !== 'PENDING') return { ok: false, error: 'Invito non più valido' };
  if (invitation.expiresAt < new Date()) {
    await prisma.invitation.update({
      where: { id: invitation.id },
      data: { status: 'EXPIRED' },
    });
    return { ok: false, error: 'Invito scaduto' };
  }

  // Scope-company: l'invito e' stato emesso per l'azienda invitation.companyId,
  // quindi l'email puo' duplicare altrove ma non in quella stessa azienda.
  const exists = await prisma.user.findFirst({
    where: { email: invitation.email, companyId: invitation.companyId },
  });
  if (exists) return { ok: false, error: 'Email già registrata in questa azienda' };

  const passwordHash = await hashPassword(password);

  await prisma.$transaction(async (tx) => {
    await tx.user.create({
      data: {
        email: invitation.email,
        passwordHash,
        nome: nome.trim(),
        cognome: cognome.trim(),
        role: invitation.role,
        status: 'ACTIVE',
        emailVerifiedAt: new Date(),
        companyId: invitation.companyId,
      },
    });
    await tx.invitation.update({
      where: { id: invitation.id },
      data: { status: 'ACCEPTED', acceptedAt: new Date() },
    });
  });

  return { ok: true };
}

export type CreateUserResult = { ok: true } | { ok: false; error: string };

/**
 * Crea direttamente un User aziendale con password impostata dall'admin
 * (decisione D-01 Opzione A: l'admin azienda gestisce le credenziali e le
 * comunica al dipendente fuori piattaforma). Niente token email, niente reset
 * link. L'utente è ACTIVE da subito.
 */
export async function createUserDirectAction(
  email: string,
  nome: string,
  cognome: string,
  password: string,
): Promise<CreateUserResult> {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if (session.user.role !== 'ADMIN_AZIENDA') {
    return { ok: false, error: "Solo l'admin azienda può creare account utente" };
  }
  const companyId = session.user.companyId!;

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

  const existing = await prisma.user.findFirst({
    where: { email: emailLower, companyId },
  });
  if (existing) {
    return {
      ok: false,
      error: 'Esiste già un utente con questa email nella tua azienda',
    };
  }

  const passwordHash = await hashPassword(password);
  await prisma.user.create({
    data: {
      email: emailLower,
      passwordHash,
      nome: nome.trim(),
      cognome: cognome.trim(),
      role: 'UTENTE_AZIENDA',
      status: 'ACTIVE',
      emailVerifiedAt: new Date(),
      companyId,
    },
  });

  revalidatePath('/team');
  return { ok: true };
}

// ============================================================
// MODIFICA UTENTE TEAM (item 01 release 2026-05)
// ============================================================

/**
 * Genera una password leggibile (10 caratteri: lettere case-mixed + numeri).
 * Esclude caratteri ambigui (0OoIl1) per ridurre errori di trascrizione.
 */
function generateTempPassword(): string {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower = 'abcdefghijkmnpqrstuvwxyz';
  const digits = '23456789';
  const all = upper + lower + digits;
  let pwd = '';
  // Garanzia: almeno 1 maiuscola, 1 minuscola, 1 cifra
  pwd += upper[Math.floor(Math.random() * upper.length)];
  pwd += lower[Math.floor(Math.random() * lower.length)];
  pwd += digits[Math.floor(Math.random() * digits.length)];
  for (let i = 0; i < 7; i++) {
    pwd += all[Math.floor(Math.random() * all.length)];
  }
  // Shuffle
  return pwd
    .split('')
    .sort(() => Math.random() - 0.5)
    .join('');
}

export type UpdateTeamUserResult = { ok: true } | { ok: false; error: string };

export async function updateTeamUserAction(
  userId: string,
  email: string,
  nome: string,
  cognome: string,
): Promise<UpdateTeamUserResult> {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if (session.user.role !== 'ADMIN_AZIENDA') {
    return { ok: false, error: "Solo l'admin azienda può modificare gli utenti" };
  }
  const companyId = session.user.companyId!;

  const target = await prisma.user.findUnique({ where: { id: userId } });
  if (!target || target.companyId !== companyId) {
    return { ok: false, error: 'Utente non trovato nella tua azienda' };
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
      where: { email: emailLower, companyId, NOT: { id: userId } },
    });
    if (conflict) {
      return {
        ok: false,
        error: 'Esiste già un altro utente con questa email nella tua azienda',
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

  revalidatePath('/team');
  revalidatePath(`/team/${userId}/edit`);
  return { ok: true };
}

export type ResetTeamUserPasswordResult =
  | { ok: true; newPassword: string }
  | { ok: false; error: string };

/**
 * Genera una nuova password per l'utente team e la ritorna in chiaro UNA
 * SOLA VOLTA al chiamante (admin azienda). La password e' visualizzata in
 * un alert one-time + bottone "copia"; non e' mai persistita in chiaro
 * (anti-pattern di sicurezza). Item 01 release 2026-05.
 */
export async function resetTeamUserPasswordAction(
  userId: string,
): Promise<ResetTeamUserPasswordResult> {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if (session.user.role !== 'ADMIN_AZIENDA') {
    return { ok: false, error: "Solo l'admin azienda può resettare le password" };
  }
  const companyId = session.user.companyId!;

  const target = await prisma.user.findUnique({ where: { id: userId } });
  if (!target || target.companyId !== companyId) {
    return { ok: false, error: 'Utente non trovato nella tua azienda' };
  }

  const newPassword = generateTempPassword();
  const passwordHash = await hashPassword(newPassword);

  await prisma.user.update({
    where: { id: userId },
    data: { passwordHash },
  });

  revalidatePath(`/team/${userId}/edit`);
  return { ok: true, newPassword };
}

export async function revokeInvitationAction(invitationId: string): Promise<void> {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if (session.user.role !== 'ADMIN_AZIENDA') redirect('/dashboard');
  const companyId = session.user.companyId!;

  const inv = await prisma.invitation.findUnique({ where: { id: invitationId } });
  if (!inv || inv.companyId !== companyId) return;
  if (inv.status !== 'PENDING') return;

  await prisma.invitation.update({
    where: { id: invitationId },
    data: { status: 'REVOKED' },
  });
  revalidatePath('/team');
}
