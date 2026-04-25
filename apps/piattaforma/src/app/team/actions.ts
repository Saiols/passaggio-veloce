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

  const existingUser = await prisma.user.findUnique({ where: { email: emailLower } });
  if (existingUser) {
    return { ok: false, error: 'Esiste già un utente con questa email' };
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
  if (!password || password.length < 10) {
    return { ok: false, error: 'Password troppo corta (min 10)' };
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

  const exists = await prisma.user.findUnique({ where: { email: invitation.email } });
  if (exists) return { ok: false, error: 'Email già registrata' };

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
