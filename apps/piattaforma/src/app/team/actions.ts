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

/**
 * Multi-sede: risolve la sede a cui assegnare un nuovo utente. Default alla sede
 * unica (caso 1:1); con più sedi serve la scelta esplicita.
 */
async function resolveTargetSede(
  companyId: string,
  sedeId?: string,
): Promise<{ ok: true; sedeId: string } | { ok: false; error: string }> {
  const sedi = await prisma.sede.findMany({
    where: { companyId, deletedAt: null },
    select: { id: true },
  });
  if (sedeId) {
    if (!sedi.some((s) => s.id === sedeId)) return { ok: false, error: 'Sede non valida' };
    return { ok: true, sedeId };
  }
  if (sedi.length === 1) return { ok: true, sedeId: sedi[0].id };
  if (sedi.length === 0) return { ok: false, error: 'Nessuna sede configurata' };
  return { ok: false, error: 'Specifica una sede per il nuovo utente' };
}

export async function createInvitationAction(
  email: string,
  sedeId?: string,
  ruoloSede?: 'ADMIN_SEDE' | 'OPERATORE',
): Promise<InviteResult> {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if (session.user.role !== 'ADMIN_AZIENDA') {
    return { ok: false, error: "Solo l'admin azienda può invitare utenti" };
  }
  const companyId = session.user.companyId!;
  const invitedById = session.user.id!;

  const targetSede = await resolveTargetSede(companyId, sedeId);
  if (!targetSede.ok) return { ok: false, error: targetSede.error };

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
      sedeId: targetSede.sedeId,
      ruoloSede: ruoloSede ?? 'OPERATORE',
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

  const { tplInvitoTeam } = await import('@/lib/auth/email-templates');
  const mail = tplInvitoTeam({
    ragioneSociale: company?.ragioneSociale ?? 'Passaggio Veloce',
    inviteUrl: link,
  });
  await getEmail().send({
    to: emailLower,
    subject: mail.subject,
    html: mail.html,
    text: mail.text,
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

  // Multi-sede: sede dell'invito (o sede unica come fallback per inviti legacy).
  let sedeId = invitation.sedeId;
  if (!sedeId) {
    const t = await resolveTargetSede(invitation.companyId);
    if (t.ok) sedeId = t.sedeId;
  }

  await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
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
    if (sedeId) {
      await tx.userSede.create({
        data: { userId: user.id, sedeId, ruolo: invitation.ruoloSede },
      });
    }
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
  sedeId?: string,
  ruoloSede?: 'ADMIN_SEDE' | 'OPERATORE',
): Promise<CreateUserResult> {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if (session.user.role !== 'ADMIN_AZIENDA') {
    return { ok: false, error: "Solo l'admin azienda può creare account utente" };
  }
  const companyId = session.user.companyId!;

  // Multi-sede: l'utente va assegnato a una sede. Default alla sede unica
  // (caso 1:1); se più sedi e nessuna scelta, richiedi la selezione.
  const targetSede = await resolveTargetSede(companyId, sedeId);
  if (!targetSede.ok) return { ok: false, error: targetSede.error };

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
  await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
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
    await tx.userSede.create({
      data: { userId: user.id, sedeId: targetSede.sedeId, ruolo: ruoloSede ?? 'OPERATORE' },
    });
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
  sedeId?: string,
  ruoloSede?: 'ADMIN_SEDE' | 'OPERATORE',
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

  // Multi-sede: aggiorna la membership (sede + ruolo) per gli UTENTE_AZIENDA. Il
  // proprietario (ADMIN_AZIENDA) ha accesso implicito a tutte le sedi → niente
  // membership. La sede deve appartenere all'azienda.
  const aggiornaMembership = target.role !== 'ADMIN_AZIENDA' && sedeId !== undefined;
  if (aggiornaMembership) {
    const sede = await prisma.sede.findFirst({
      where: { id: sedeId, companyId, deletedAt: null },
      select: { id: true },
    });
    if (!sede) return { ok: false, error: 'Sede non valida' };
  }
  const ruolo = ruoloSede ?? 'OPERATORE';

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: userId },
      data: { email: emailLower, nome: nome.trim(), cognome: cognome.trim() },
    });
    if (aggiornaMembership) {
      // Modello "una sede per utente": l'utente appartiene a una sola sede. Per
      // evitare conflitti con @@unique([userId, sedeId]) quando si sposta sede,
      // collassiamo a un'unica membership con la sede/ruolo scelti.
      const existing = await tx.userSede.findFirst({ where: { userId } });
      if (existing && existing.sedeId === sedeId) {
        await tx.userSede.update({ where: { id: existing.id }, data: { ruolo } });
      } else {
        await tx.userSede.deleteMany({ where: { userId } });
        await tx.userSede.create({ data: { userId, sedeId: sedeId!, ruolo } });
      }
    }
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

export type DisableTeamUserResult = { ok: true } | { ok: false; error: string };

/**
 * Disabilitazione immediata di un utente team: status=SUSPENDED +
 * deletedAt=now(). L'utente non può più accedere e sparisce dalla lista
 * /team. Stesso pattern di deleteCompanyAction (item 17 release 2026-05).
 * L'anonimizzazione PII per compliance GDPR avviene dopo 90gg via cron
 * `purge-deleted-team-users`.
 */
export async function disableTeamUserAction(
  userId: string,
): Promise<DisableTeamUserResult> {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if (session.user.role !== 'ADMIN_AZIENDA') {
    return { ok: false, error: "Solo l'admin azienda può eliminare utenti" };
  }
  if (userId === session.user.id) {
    return { ok: false, error: 'Non puoi eliminare il tuo stesso account' };
  }
  const companyId = session.user.companyId!;

  const target = await prisma.user.findUnique({ where: { id: userId } });
  if (!target || target.companyId !== companyId) {
    return { ok: false, error: 'Utente non trovato nella tua azienda' };
  }
  if (target.deletedAt) {
    return { ok: false, error: 'Utente già eliminato' };
  }

  await prisma.user.update({
    where: { id: userId },
    data: { status: 'SUSPENDED', deletedAt: new Date() },
  });

  revalidatePath('/team');
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
