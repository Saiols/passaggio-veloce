'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { prisma } from '@pv/db';
import { isAdminOrAssistente, isAdminPiattaforma } from '@/lib/auth/permissions';
import { sendNotification } from '@/lib/notifiche';
import { eseguiPayoutImmediato } from '@/lib/wallet/payout-exec';

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
 *
 * Clausola 11.3-bis dei Termini (quarta misura, distinta dalla sospensione
 * dell'intera azienda al punto 11.3): "la sospensione è comunicata via email
 * con indicazione del motivo". Come `suspendCompanyAction`, il motivo NON è
 * opzionale: senza di esso il diritto di riesame previsto dalla stessa
 * clausola sarebbe svuotato. Rifiutata se vuoto dopo il trim.
 */
export async function suspendUserAction(
  userId: string,
  noteRaw: string | undefined,
): Promise<SuspensionResult> {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if (!isAdminOrAssistente(session.user.role)) {
    return { ok: false, error: 'Operazione riservata ad admin/assistente' };
  }
  if (userId === session.user.id) {
    return { ok: false, error: 'Non puoi sospendere te stesso' };
  }
  const note = sanitizeNote(noteRaw);
  if (!note) {
    return {
      ok: false,
      error:
        'Indica il motivo della sospensione: è obbligatorio (clausola 11.3-bis dei Termini) e viene incluso nell\'email inviata all\'utente.',
    };
  }

  await prisma.user.update({
    where: { id: userId },
    data: { status: 'SUSPENDED', suspensionLastNote: note },
  });

  // Email best-effort all'utente sospeso, con il motivo (clausola 11.3-bis).
  // L'account aziendale e le altre utenze NON sono toccati da questa azione:
  // il payload lo dichiara esplicitamente nel template N45.
  try {
    const u = await prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, nome: true, companyId: true, company: { select: { ragioneSociale: true } } },
    });
    if (u) {
      await sendNotification({
        tipo: 'N45_UTENTE_SOSPESO',
        target: { email: u.email, userId, companyId: u.companyId },
        payload: {
          nomeUtente: u.nome,
          ragioneSociale: u.company?.ragioneSociale ?? '—',
          motivo: note,
        },
      });
    }
  } catch {
    // best-effort
  }

  revalidatePath('/admin/utenti');
  return { ok: true };
}

export async function reactivateUserAction(
  userId: string,
  noteRaw?: string,
): Promise<SuspensionResult> {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if (!isAdminOrAssistente(session.user.role)) {
    return { ok: false, error: 'Operazione riservata ad admin/assistente' };
  }
  const note = sanitizeNote(noteRaw);
  await prisma.user.update({
    where: { id: userId },
    data: { status: 'ACTIVE', suspensionLastNote: note },
  });
  revalidatePath('/admin/utenti');
  return { ok: true };
}

/**
 * F-01: sospende un'azienda intera (broker o agenzia). Setta suspendedAt
 * e sospende tutti i suoi utenti in cascata. Reversibile via reactivate.
 *
 * Clausola 11.3 dei Termini: "la sospensione è comunicata via email con
 * indicazione del motivo". Il motivo NON è più opzionale: senza di esso il
 * diritto di riesame previsto dalla stessa clausola sarebbe svuotato (l'utente
 * non saprebbe cosa contestare). Rifiutata se vuoto dopo il trim.
 */
export async function suspendCompanyAction(
  companyId: string,
  noteRaw: string | undefined,
): Promise<SuspensionResult> {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if (!isAdminOrAssistente(session.user.role)) {
    return { ok: false, error: 'Operazione riservata ad admin/assistente' };
  }
  const note = sanitizeNote(noteRaw);
  if (!note) {
    return {
      ok: false,
      error:
        'Indica il motivo della sospensione: è obbligatorio (clausola 11.3 dei Termini) e viene incluso nell\'email inviata all\'azienda.',
    };
  }
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

  // Clausola 11.4 dei Termini: alla cessazione il saldo residuo è liquidato
  // integralmente, ANCHE se inferiore a 500 €. Best-effort: un fallimento
  // dell'erogazione non deve bloccare la cancellazione — resta il credito a
  // registro, che l'admin liquida a mano.
  try {
    const wallets = await prisma.wallet.findMany({
      where: {
        OR: [{ companyId }, { sede: { companyId } }],
        saldoCent: { gt: 0 },
      },
      select: { id: true },
    });
    for (const w of wallets) {
      await eseguiPayoutImmediato(w.id, { ignoraSoglia: true }).catch(() => undefined);
    }
  } catch {
    // best-effort
  }

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

/**
 * Revoca la sospensione anti-abuso di una SEDE (5 no-show consecutivi).
 * È l'unico modo per riattivarla: `setSedeSuspended` la rifiuta al titolare.
 * Cfr. clausola 11.2 dei Termini (revoca previa verifica di Passaggio Veloce).
 */
export async function reactivateSedeAntiAbusoAction(
  sedeId: string,
): Promise<SuspensionResult> {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if (!isAdminOrAssistente(session.user.role)) {
    return { ok: false, error: 'Operazione riservata ad admin/assistente' };
  }

  // Guardia: questa azione esiste SOLO per sciogliere la sanzione anti-abuso
  // (5 no-show consecutivi). Senza questo controllo riattiverebbe anche una
  // sede sospesa volontariamente dal titolare (es. per ferie/chiusura
  // stagionale, `suspensionOrigin: 'UTENTE'`) — non è una falla di sicurezza
  // (azione admin-only, la UI mostra il bottone solo per sedi ANTI_ABUSO), ma
  // scavalcherebbe una scelta organizzativa dell'utente per errore.
  const sede = await prisma.sede.findUnique({
    where: { id: sedeId },
    select: { suspensionOrigin: true },
  });
  if (!sede || sede.suspensionOrigin !== 'ANTI_ABUSO') {
    return { ok: false, error: 'Questa sede non risulta sospesa dal sistema anti-abuso' };
  }

  await prisma.sede.update({
    where: { id: sedeId, suspensionOrigin: 'ANTI_ABUSO' },
    data: { suspendedAt: null, suspensionOrigin: null },
  });

  revalidatePath('/admin/agenzie');
  revalidatePath('/sedi');
  return { ok: true };
}
