'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { prisma } from '@pv/db';
import { isAdminOrAssistente, isAdminPiattaforma } from '@/lib/auth/permissions';
import { sendNotification } from '@/lib/notifiche';

/**
 * Helper: invia notifica lifecycle a tutti gli utenti attivi di una company,
 * best-effort (errori provider non bloccano l'azione admin). Item 17 release
 * 2026-05.
 */
async function notifyCompanyLifecycle(
  companyId: string,
  tipo: 'N14_ACCOUNT_SOSPESO' | 'N15_ACCOUNT_RIATTIVATO' | 'N16_ACCOUNT_ELIMINATO',
  motivo?: string | null,
): Promise<void> {
  try {
    const company = await prisma.company.findUnique({
      where: { id: companyId },
      select: {
        id: true,
        ragioneSociale: true,
        users: {
          where: { deletedAt: null },
          select: { id: true, email: true, nome: true },
        },
      },
    });
    if (!company) return;
    for (const u of company.users) {
      if (tipo === 'N14_ACCOUNT_SOSPESO') {
        await sendNotification({
          tipo,
          target: { email: u.email, userId: u.id, companyId: company.id },
          payload: {
            nomeUtente: u.nome,
            ragioneSociale: company.ragioneSociale,
            motivo: motivo ?? null,
          },
        }).catch(() => undefined);
      } else if (tipo === 'N15_ACCOUNT_RIATTIVATO') {
        await sendNotification({
          tipo,
          target: { email: u.email, userId: u.id, companyId: company.id },
          payload: {
            nomeUtente: u.nome,
            ragioneSociale: company.ragioneSociale,
            motivo: motivo ?? null,
          },
        }).catch(() => undefined);
      } else {
        await sendNotification({
          tipo,
          target: { email: u.email, userId: u.id, companyId: company.id },
          payload: {
            nomeUtente: u.nome,
            ragioneSociale: company.ragioneSociale,
          },
        }).catch(() => undefined);
      }
    }
  } catch {
    // best-effort
  }
}

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
  noteRaw?: string,
): Promise<SuspensionResult> {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if (!isAdminOrAssistente(session.user.role)) {
    return { ok: false, error: 'Operazione riservata ad admin/assistente' };
  }
  const note = sanitizeNote(noteRaw);
  await prisma.$transaction([
    prisma.company.update({
      where: { id: companyId },
      data: { suspendedAt: new Date(), suspensionLastNote: note },
    }),
    prisma.user.updateMany({
      where: { companyId },
      data: { status: 'SUSPENDED' },
    }),
  ]);
  await notifyCompanyLifecycle(companyId, 'N14_ACCOUNT_SOSPESO', note);
  revalidatePath('/admin/agenzie');
  revalidatePath('/admin/broker');
  revalidatePath('/admin/utenti');
  return { ok: true };
}

export async function reactivateCompanyAction(
  companyId: string,
  noteRaw?: string,
): Promise<SuspensionResult> {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if (!isAdminOrAssistente(session.user.role)) {
    return { ok: false, error: 'Operazione riservata ad admin/assistente' };
  }
  const note = sanitizeNote(noteRaw);
  await prisma.$transaction([
    prisma.company.update({
      where: { id: companyId },
      data: { suspendedAt: null, suspensionLastNote: note },
    }),
    prisma.user.updateMany({
      where: { companyId, status: 'SUSPENDED' },
      data: { status: 'ACTIVE' },
    }),
  ]);
  await notifyCompanyLifecycle(companyId, 'N15_ACCOUNT_RIATTIVATO', note);
  revalidatePath('/admin/agenzie');
  revalidatePath('/admin/broker');
  revalidatePath('/admin/utenti');
  return { ok: true };
}

function sanitizeNote(raw: string | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, 1000);
}

/**
 * Eliminazione definitiva di una company (item 17 release 2026-05).
 * Soft delete immediato + notifica email. Hard delete dei dati personali
 * (documenti, recapiti) lascia agli script di retention a 90gg compliance
 * GDPR (job da implementare). Le pratiche storiche restano per audit
 * ma il riferimento alla company eliminata si renderizza come
 * "Account eliminato" lato UI (vedi fallback in /admin/pratiche).
 */
export async function deleteCompanyAction(
  companyId: string,
  confirmRagioneSociale: string,
): Promise<SuspensionResult> {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if (!isAdminPiattaforma(session.user.role)) {
    return {
      ok: false,
      error: "Solo l'admin platform può eliminare definitivamente un account",
    };
  }

  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { ragioneSociale: true, deletedAt: true },
  });
  if (!company) return { ok: false, error: 'Azienda non trovata' };
  if (company.deletedAt) return { ok: false, error: 'Azienda già eliminata' };
  if (company.ragioneSociale.trim() !== confirmRagioneSociale.trim()) {
    return {
      ok: false,
      error: 'Conferma errata: digita esattamente la ragione sociale',
    };
  }

  // Notifica PRIMA del soft delete: dopo, gli user sono SUSPENDED e
  // l'invio resta valido perche' attinge da deletedAt: null al momento
  // della chiamata (il suspension non azzera deletedAt).
  await notifyCompanyLifecycle(companyId, 'N16_ACCOUNT_ELIMINATO');

  const now = new Date();
  await prisma.$transaction([
    prisma.company.update({
      where: { id: companyId },
      data: { suspendedAt: now, deletedAt: now },
    }),
    prisma.user.updateMany({
      where: { companyId, deletedAt: null },
      data: { status: 'SUSPENDED', deletedAt: now },
    }),
  ]);

  revalidatePath('/admin/agenzie');
  revalidatePath('/admin/broker');
  revalidatePath('/admin/utenti');
  return { ok: true };
}
