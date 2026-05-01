'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { prisma } from '@pv/db';
import { isAdminOrAssistente } from '@/lib/auth/permissions';

export type SuspensionResult = { ok: true } | { ok: false; error: string };

/**
 * F-01: sospende un singolo utente. Visibile a ADMIN_PIATTAFORMA + ASSISTENTE.
 * L'utente sospeso non può fare login (auth.ts esce a null su SUSPENDED).
 */
export async function suspendUserAction(userId: string): Promise<SuspensionResult> {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if (!isAdminOrAssistente(session.user.role)) {
    return { ok: false, error: 'Operazione riservata ad admin/assistente' };
  }
  if (userId === session.user.id) {
    return { ok: false, error: 'Non puoi sospendere te stesso' };
  }
  await prisma.user.update({
    where: { id: userId },
    data: { status: 'SUSPENDED' },
  });
  revalidatePath('/admin/utenti');
  return { ok: true };
}

export async function reactivateUserAction(userId: string): Promise<SuspensionResult> {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if (!isAdminOrAssistente(session.user.role)) {
    return { ok: false, error: 'Operazione riservata ad admin/assistente' };
  }
  await prisma.user.update({
    where: { id: userId },
    data: { status: 'ACTIVE' },
  });
  revalidatePath('/admin/utenti');
  return { ok: true };
}

/**
 * F-01: sospende un'azienda intera (broker o agenzia). Setta suspendedAt
 * e sospende tutti i suoi utenti in cascata. Reversibile via reactivate.
 */
export async function suspendCompanyAction(
  companyId: string,
): Promise<SuspensionResult> {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if (!isAdminOrAssistente(session.user.role)) {
    return { ok: false, error: 'Operazione riservata ad admin/assistente' };
  }
  await prisma.$transaction([
    prisma.company.update({
      where: { id: companyId },
      data: { suspendedAt: new Date() },
    }),
    prisma.user.updateMany({
      where: { companyId },
      data: { status: 'SUSPENDED' },
    }),
  ]);
  revalidatePath('/admin/agenzie');
  revalidatePath('/admin/broker');
  revalidatePath('/admin/utenti');
  return { ok: true };
}

export async function reactivateCompanyAction(
  companyId: string,
): Promise<SuspensionResult> {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if (!isAdminOrAssistente(session.user.role)) {
    return { ok: false, error: 'Operazione riservata ad admin/assistente' };
  }
  await prisma.$transaction([
    prisma.company.update({
      where: { id: companyId },
      data: { suspendedAt: null },
    }),
    prisma.user.updateMany({
      where: { companyId, status: 'SUSPENDED' },
      data: { status: 'ACTIVE' },
    }),
  ]);
  revalidatePath('/admin/agenzie');
  revalidatePath('/admin/broker');
  revalidatePath('/admin/utenti');
  return { ok: true };
}
