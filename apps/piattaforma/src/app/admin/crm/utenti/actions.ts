'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { prisma } from '@pv/db';
import { hashPassword } from '@/lib/auth/password';
import {
  canManageCrmTeamUsers,
  canManageCrmTeamUser,
  creatableCrmRoles,
} from '@/lib/auth/permissions';
import { normalizzaEmail, emailGiaInUso, EMAIL_GIA_IN_USO, scriviUtente } from '@/lib/auth/email-univoca';

export type CrmUserResult =
  | { ok: true; id: string }
  | { ok: false; error: string };

const PWD_SCHEMA = z
  .string()
  .min(8, 'Password troppo corta (min 8)')
  .regex(/[A-Z]/, 'Serve almeno una maiuscola')
  .regex(/[a-z]/, 'Serve almeno una minuscola')
  .regex(/[0-9]/, 'Serve almeno una cifra');

const CREATE_SCHEMA = z.object({
  nome: z.string().trim().min(1).max(80),
  cognome: z.string().trim().min(1).max(80),
  email: z.string().trim().email().max(160),
  role: z.enum([
    'ADMIN_PIATTAFORMA',
    'AD',
    'CTO',
    'CFO',
    'SALES_MANAGER',
    'SALES',
  ]),
  password: PWD_SCHEMA,
});

const UPDATE_SCHEMA = z.object({
  nome: z.string().trim().min(1).max(80),
  cognome: z.string().trim().min(1).max(80),
  email: z.string().trim().email().max(160),
  role: z.enum([
    'ADMIN_PIATTAFORMA',
    'AD',
    'CTO',
    'CFO',
    'SALES_MANAGER',
    'SALES',
  ]),
});

export type CreateCrmUserInput = z.infer<typeof CREATE_SCHEMA>;
export type UpdateCrmUserInput = z.infer<typeof UPDATE_SCHEMA>;

export async function createCrmTeamUserAction(
  raw: unknown,
): Promise<CrmUserResult> {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if (!canManageCrmTeamUsers(session.user.role)) {
    return { ok: false, error: 'Non hai i permessi per creare utenti CRM' };
  }

  const parsed = CREATE_SCHEMA.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return {
      ok: false,
      error: first ? `${first.path.join('.')}: ${first.message}` : 'Dati non validi',
    };
  }
  const d = parsed.data;

  // RBAC: il ruolo richiesto deve essere creatable dal currentUser
  const allowed = creatableCrmRoles(session.user.role);
  if (!allowed.includes(d.role)) {
    return {
      ok: false,
      error: `Non puoi creare utenti con ruolo ${d.role}`,
    };
  }

  // Email univoca su tutta la piattaforma (spec 2026-07-25).
  const emailLower = normalizzaEmail(d.email);
  if (await emailGiaInUso(emailLower)) {
    return { ok: false, error: EMAIL_GIA_IN_USO };
  }

  const passwordHash = await hashPassword(d.password);
  const scritto = await scriviUtente(() =>
    prisma.user.create({
      data: {
        email: emailLower,
        passwordHash,
        nome: d.nome,
        cognome: d.cognome,
        role: d.role,
        status: 'ACTIVE',
        emailVerifiedAt: new Date(),
        companyId: null,
      },
      select: { id: true },
    }),
  );
  if (!scritto.ok) return scritto;
  const created = scritto.value;

  revalidatePath('/admin/crm/utenti');
  return { ok: true, id: created.id };
}

export async function updateCrmTeamUserAction(
  id: string,
  raw: unknown,
): Promise<CrmUserResult> {
  const session = await auth();
  if (!session?.user) redirect('/login');

  const target = await prisma.user.findUnique({
    where: { id },
    select: { id: true, role: true, companyId: true },
  });
  if (!target || target.companyId !== null) {
    return { ok: false, error: 'Utente team non trovato' };
  }
  if (
    !canManageCrmTeamUser(session.user.role, session.user.id, {
      id: target.id,
      role: target.role,
    })
  ) {
    return { ok: false, error: 'Non hai i permessi per modificare questo utente' };
  }

  const parsed = UPDATE_SCHEMA.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return {
      ok: false,
      error: first ? `${first.path.join('.')}: ${first.message}` : 'Dati non validi',
    };
  }
  const d = parsed.data;

  // Cambio ruolo: solo se il nuovo ruolo è creatable dal currentUser
  if (d.role !== target.role) {
    const allowed = creatableCrmRoles(session.user.role);
    if (!allowed.includes(d.role)) {
      return {
        ok: false,
        error: `Non puoi assegnare il ruolo ${d.role}`,
      };
    }
  }

  const emailLower = normalizzaEmail(d.email);
  if (await emailGiaInUso(emailLower, { escludiUserId: id })) {
    return { ok: false, error: EMAIL_GIA_IN_USO };
  }

  const scritto = await scriviUtente(() =>
    prisma.user.update({
      where: { id },
      data: {
        nome: d.nome,
        cognome: d.cognome,
        email: emailLower,
        role: d.role,
      },
    }),
  );
  if (!scritto.ok) return scritto;

  revalidatePath('/admin/crm/utenti');
  return { ok: true, id };
}

export type ResetCrmUserPasswordResult =
  | { ok: true; newPassword: string }
  | { ok: false; error: string };

/**
 * Genera password temporanea leggibile (10 char), come pattern team standard.
 * Mostrata UNA SOLA VOLTA al creatore.
 */
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

export async function resetCrmTeamUserPasswordAction(
  id: string,
): Promise<ResetCrmUserPasswordResult> {
  const session = await auth();
  if (!session?.user) redirect('/login');

  const target = await prisma.user.findUnique({
    where: { id },
    select: { id: true, role: true, companyId: true },
  });
  if (!target || target.companyId !== null) {
    return { ok: false, error: 'Utente team non trovato' };
  }
  if (
    !canManageCrmTeamUser(session.user.role, session.user.id, {
      id: target.id,
      role: target.role,
    })
  ) {
    return { ok: false, error: 'Non hai i permessi per resettare questo utente' };
  }

  const newPassword = generateTempPassword();
  const passwordHash = await hashPassword(newPassword);

  await prisma.user.update({
    where: { id },
    data: { passwordHash },
  });

  revalidatePath('/admin/crm/utenti');
  return { ok: true, newPassword };
}

export async function deleteCrmTeamUserAction(
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await auth();
  if (!session?.user) redirect('/login');

  const target = await prisma.user.findUnique({
    where: { id },
    select: { id: true, role: true, companyId: true },
  });
  if (!target || target.companyId !== null) {
    return { ok: false, error: 'Utente team non trovato' };
  }
  if (
    !canManageCrmTeamUser(session.user.role, session.user.id, {
      id: target.id,
      role: target.role,
    })
  ) {
    return { ok: false, error: 'Non hai i permessi per eliminare questo utente' };
  }

  // Soft delete: il sales può aver assegnato contatti, mantengo audit trail.
  // I CrmContact.assignedTo perdono il riferimento via SET NULL.
  await prisma.user.update({
    where: { id },
    data: {
      deletedAt: new Date(),
      status: 'SUSPENDED',
    },
  });

  revalidatePath('/admin/crm/utenti');
  return { ok: true };
}
