import 'server-only';
import { cookies } from 'next/headers';
import { prisma } from '@pv/db';
import { auth } from '@/auth';
import { isOwner as isOwnerRole } from '@/lib/auth/permissions';
import {
  resolveAccessibleSedi,
  resolveCurrentSede,
  resolveOperatingSede,
  resolveSedeRole,
  manageableSedi,
  sedeScopeIds,
  type SedeRef,
  type CurrentSede,
  type SedeRole,
  type SedeRuolo,
} from '@/lib/sedi/scope';

/** Cookie che porta la sede operativa corrente (id sede oppure 'ALL' per il proprietario). */
export const SEDE_COOKIE = 'pv_sede';

export type SessionUser = {
  id: string;
  role: string;
  companyId?: string;
  [k: string]: unknown;
};

export type SessionContext = {
  user: SessionUser;
  companyId: string | undefined;
  /** Proprietario madre (ADMIN_AZIENDA): accesso implicito a tutte le sedi. */
  isOwner: boolean;
  accessibleSedi: SedeRef[];
  currentSede: CurrentSede | null;
  /** Sedi su cui filtrare le query operative (`{ in: scopeIds }`). */
  scopeIds: string[];
  /** Ruolo per sede dell'utente (solo membership non-owner). */
  membershipRuoli: Record<string, SedeRuolo>;
};

/**
 * Contesto multi-sede dell'utente loggato: sedi accessibili e sede corrente.
 * Fonte unica di scoping per le aree operative. Ritorna null se non loggato.
 * Gli admin piattaforma (companyId null) non hanno contesto sede.
 */
export async function getSessionContext(): Promise<SessionContext | null> {
  const session = await auth();
  if (!session?.user) return null;

  const user = session.user as SessionUser;
  const companyId = user.companyId;
  const isOwner = isOwnerRole(user.role);

  if (!companyId) {
    return {
      user,
      companyId: undefined,
      isOwner: false,
      accessibleSedi: [],
      currentSede: null,
      scopeIds: [],
      membershipRuoli: {},
    };
  }

  const [companySedi, memberships] = await Promise.all([
    prisma.sede.findMany({
      where: { companyId, deletedAt: null },
      select: { id: true, nome: true, type: true },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.userSede.findMany({
      where: { userId: user.id, sede: { companyId, deletedAt: null } },
      select: { sedeId: true, ruolo: true },
    }),
  ]);

  const accessibleSedi = resolveAccessibleSedi({
    isOwner,
    companySedi: companySedi as SedeRef[],
    membershipSedeIds: memberships.map((m) => m.sedeId),
  });

  const cookieValue = (await cookies()).get(SEDE_COOKIE)?.value ?? null;
  const currentSede = resolveCurrentSede({ isOwner, accessibleSedi, cookieValue });
  const scopeIds = sedeScopeIds({ currentSede, accessibleSedi });

  const membershipRuoli: Record<string, SedeRuolo> = {};
  for (const m of memberships) membershipRuoli[m.sedeId] = m.ruolo as SedeRuolo;

  return { user, companyId, isOwner, accessibleSedi, currentSede, scopeIds, membershipRuoli };
}

/**
 * Sede in cui l'utente sta operando per una scrittura (es. configurare il
 * calendario di una sede). Null se nessun contesto o se il proprietario è in
 * vista aggregata con più sedi (deve prima selezionarne una).
 */
export async function getOperatingSede(): Promise<SedeRef | null> {
  const ctx = await getSessionContext();
  if (!ctx) return null;
  return resolveOperatingSede({ currentSede: ctx.currentSede, accessibleSedi: ctx.accessibleSedi });
}

/** Ruolo effettivo dell'utente su una sede specifica (OWNER/ADMIN_SEDE/OPERATORE/null). */
export async function getSedeRole(sedeId: string): Promise<SedeRole> {
  const ctx = await getSessionContext();
  if (!ctx) return null;
  return resolveSedeRole({
    isOwner: ctx.isOwner,
    accessibleSedi: ctx.accessibleSedi,
    membershipRuoli: ctx.membershipRuoli,
    sedeId,
  });
}

/** Sedi su cui l'utente può gestire team/impostazioni (OWNER o ADMIN_SEDE). */
export async function getManageableSedi(): Promise<SedeRef[]> {
  const ctx = await getSessionContext();
  if (!ctx) return [];
  return manageableSedi({
    isOwner: ctx.isOwner,
    accessibleSedi: ctx.accessibleSedi,
    membershipRuoli: ctx.membershipRuoli,
  });
}
