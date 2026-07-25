'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@pv/db';
import { generateSecureToken, expiresIn } from '@/lib/auth/tokens';
import { hashPassword } from '@/lib/auth/password';
import { getEmail } from '@/lib/providers/email';
import { env } from '@/env';
import { getSessionContext } from '@/lib/auth/session-context';
import {
  manageableSedi,
  resolveSedeRole,
  resolveTeamTargetSede,
  assignableSedeRoles,
  type SedeRole,
} from '@/lib/sedi/scope';
import { can, permessiPerNuovoUtente, validaPermessi, type PermessiCtx } from '@/lib/auth/permessi/check';
import { toPermessiCtx } from '@/lib/auth/permessi/guard';
import { isLettura } from '@/lib/auth/permessi/sola-lettura';
import { ERRORE_SOSPENSIONE } from '@/lib/auth/sospensione';
import type { CompanyTypeP, Permesso } from '@/lib/auth/permessi/catalogo';
import type { Role } from '@/lib/auth/permissions';
import { normalizzaEmail, emailGiaInUso, EMAIL_GIA_IN_USO, scriviUtente } from '@/lib/auth/email-univoca';

export type InviteResult =
  | { ok: true; demoLink?: string }
  | { ok: false; error: string };

/**
 * Multi-sede: risolve la sede a cui assegnare un nuovo utente. Default alla sede
 * unica (caso 1:1); con più sedi serve la scelta esplicita.
 *
 * Usata SOLO da `acceptInvitationAction` come fallback per inviti legacy senza
 * `sedeId` (flusso senza sessione autenticata: l'utente non è ancora loggato,
 * quindi non può passare dai gate sede-aware `authorizeTeamCreate` /
 * `authorizeTeamTargetUser` sotto, che richiedono `getSessionContext()`). Le
 * altre action team ora risolvono/autorizzano la sede tramite quei due helper.
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

type RuoloSedeInput = 'ADMIN_SEDE' | 'OPERATORE';

/**
 * Gate di capability: SOLO autenticazione + permesso, prima di qualunque
 * risoluzione di scope (sede, target). Regola del progetto: autenticazione →
 * permesso → scope — non far lavorare il DB (e non rivelare nulla sullo scope,
 * es. l'esistenza di un utente in un'altra sede) per un chiamante che comunque
 * non è autorizzato. `getSessionContext()` è `cache()`-ato per richiesta
 * (session-context.ts): richiamarlo qui e poi dentro `authorizeTeamCreate` /
 * `authorizeTeamTargetUser` non costa una seconda query.
 *
 * Il contesto di permessi passa SEMPRE da `toPermessiCtx()` (unico adattatore,
 * in `permessi/guard.ts`): un adattatore locale può dimenticare `soloLettura`
 * ed è esattamente cosa succedeva qui prima — un titolare sospeso passava
 * questo gate su tutte e sei le azioni del modulo team.
 */
async function gateCapability(
  p: Permesso,
  errorMessage: string,
): Promise<{ ok: false; error: string } | null> {
  const ctx = await getSessionContext();
  if (!ctx?.companyId) return { ok: false, error: 'Non autenticato' };
  const pctx = toPermessiCtx(ctx);
  if (can(pctx, p)) return null;
  // Diniego per sospensione: messaggio dedicato, non il generico "non hai i
  // permessi" (l'utente i permessi li ha, li ha persi solo temporaneamente).
  if (pctx.soloLettura && !isLettura(p)) return { ok: false, error: ERRORE_SOSPENSIONE };
  return { ok: false, error: errorMessage };
}

/**
 * Autorizza la CREAZIONE di un utente su una sede: risolve la sede destinataria
 * tra quelle gestibili dall'utente e valida il ruolo richiesto.
 */
async function authorizeTeamCreate(
  requestedSedeId: string | undefined,
  requestedRuolo: RuoloSedeInput | undefined,
): Promise<
  | {
      ok: true;
      companyId: string;
      sedeId: string;
      ruolo: RuoloSedeInput;
      userId: string;
      permessiCtx: PermessiCtx;
      companyType: CompanyTypeP;
    }
  | { ok: false; error: string }
> {
  const ctx = await getSessionContext();
  if (!ctx?.companyId) return { ok: false, error: 'Non autenticato' };
  const manageable = manageableSedi({
    isOwner: ctx.isOwner,
    accessibleSedi: ctx.accessibleSedi,
    membershipRuoli: ctx.membershipRuoli,
  });
  if (manageable.length === 0) {
    return { ok: false, error: 'Non hai i permessi per gestire il team' };
  }
  const target = resolveTeamTargetSede({ requestedSedeId, manageable });
  if (!target.ok) return { ok: false, error: target.error };
  const role = resolveSedeRole({
    isOwner: ctx.isOwner,
    accessibleSedi: ctx.accessibleSedi,
    membershipRuoli: ctx.membershipRuoli,
    sedeId: target.sedeId,
  });
  const ruolo = requestedRuolo ?? 'OPERATORE';
  if (!assignableSedeRoles(role).includes(ruolo)) {
    return { ok: false, error: 'Ruolo non assegnabile' };
  }
  if (!ctx.companyType) return { ok: false, error: 'Azienda senza tipo' };
  return {
    ok: true,
    companyId: ctx.companyId,
    sedeId: target.sedeId,
    ruolo,
    userId: ctx.user.id,
    permessiCtx: toPermessiCtx(ctx),
    companyType: ctx.companyType,
  };
}

/**
 * Autorizza un'operazione su un utente ESISTENTE (modifica/reset/disabilita):
 * il chiamante deve gestire una delle sedi di membership del target. Il
 * proprietario gestisce tutti. Il target deve essere nella stessa madre.
 */
async function authorizeTeamTargetUser(
  userId: string,
): Promise<
  | {
      ok: true;
      companyId: string;
      isOwner: boolean;
      manageableIds: string[];
      permessiCtx: PermessiCtx;
      companyType: CompanyTypeP | undefined;
      targetRole: Role;
    }
  | { ok: false; error: string }
> {
  const ctx = await getSessionContext();
  if (!ctx?.companyId) return { ok: false, error: 'Non autenticato' };
  const manageable = manageableSedi({
    isOwner: ctx.isOwner,
    accessibleSedi: ctx.accessibleSedi,
    membershipRuoli: ctx.membershipRuoli,
  });
  if (manageable.length === 0) return { ok: false, error: 'Non hai i permessi' };

  const target = await prisma.user.findUnique({ where: { id: userId } });
  if (!target || target.companyId !== ctx.companyId) {
    return { ok: false, error: 'Utente non trovato nella tua azienda' };
  }
  const manageableIds = manageable.map((s) => s.id);
  if (!ctx.isOwner) {
    // Il target deve avere una membership in una sede gestita dal chiamante.
    const membership = await prisma.userSede.findFirst({
      where: { userId, sedeId: { in: manageableIds } },
      select: { id: true },
    });
    if (!membership) return { ok: false, error: 'Utente non nella tua sede' };
  }
  return {
    ok: true,
    companyId: ctx.companyId,
    isOwner: ctx.isOwner,
    manageableIds,
    permessiCtx: toPermessiCtx(ctx),
    companyType: ctx.companyType,
    targetRole: target.role,
  };
}

export async function createInvitationAction(
  email: string,
  sedeId?: string,
  ruoloSede?: RuoloSedeInput,
  permessi?: string[],
): Promise<InviteResult> {
  const gate = await gateCapability('team.invita', 'Non hai i permessi per invitare utenti');
  if (gate) return gate;
  const authz = await authorizeTeamCreate(sedeId, ruoloSede);
  if (!authz.ok) return { ok: false, error: authz.error };
  const perm = permessiPerNuovoUtente(authz.permessiCtx, authz.companyType, permessi);
  if (!perm.ok) return { ok: false, error: perm.error };
  const companyId = authz.companyId;
  const invitedById = authz.userId;

  const emailLower = normalizzaEmail(email);
  if (!emailLower || !/^[^@]+@[^@]+\.[^@]+$/.test(emailLower)) {
    return { ok: false, error: 'Email non valida' };
  }

  // Email univoca su tutta la piattaforma (spec 2026-07-25): non si invita
  // qualcuno che ha gia' un account, nemmeno in un'altra azienda.
  if (await emailGiaInUso(emailLower)) {
    return { ok: false, error: EMAIL_GIA_IN_USO };
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
      sedeId: authz.sedeId,
      ruoloSede: authz.ruolo,
      permessi: perm.permessi,
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

  // Ri-verifica al momento dell'accettazione: fra l'invio dell'invito e ora
  // l'email puo' essere stata presa da un'altra registrazione.
  if (await emailGiaInUso(invitation.email)) {
    return { ok: false, error: EMAIL_GIA_IN_USO };
  }

  const passwordHash = await hashPassword(password);

  // Multi-sede: sede dell'invito (o sede unica come fallback per inviti legacy).
  let sedeId = invitation.sedeId;
  if (!sedeId) {
    const t = await resolveTargetSede(invitation.companyId);
    if (t.ok) sedeId = t.sedeId;
  }

  const scritto = await scriviUtente(() =>
    prisma.$transaction(async (tx) => {
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
          permessi: invitation.permessi,
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
    }),
  );
  if (!scritto.ok) return scritto;

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
  ruoloSede?: RuoloSedeInput,
  permessi?: string[],
): Promise<CreateUserResult> {
  const gate = await gateCapability('team.crea', 'Non hai i permessi per creare utenti');
  if (gate) return gate;
  const authz = await authorizeTeamCreate(sedeId, ruoloSede);
  if (!authz.ok) return { ok: false, error: authz.error };
  const perm = permessiPerNuovoUtente(authz.permessiCtx, authz.companyType, permessi);
  if (!perm.ok) return { ok: false, error: perm.error };
  const { companyId } = authz;

  const emailLower = normalizzaEmail(email);
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

  if (await emailGiaInUso(emailLower)) {
    return { ok: false, error: EMAIL_GIA_IN_USO };
  }

  const passwordHash = await hashPassword(password);
  const scritto = await scriviUtente(() =>
    prisma.$transaction(async (tx) => {
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
          permessi: perm.permessi,
        },
      });
      await tx.userSede.create({
        data: { userId: user.id, sedeId: authz.sedeId, ruolo: authz.ruolo },
      });
    }),
  );
  if (!scritto.ok) return scritto;

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
  ruoloSede?: RuoloSedeInput,
  permessi?: string[],
): Promise<UpdateTeamUserResult> {
  const gate = await gateCapability('team.modifica', 'Non hai i permessi per modificare utenti');
  if (gate) return gate;
  const authz = await authorizeTeamTargetUser(userId);
  if (!authz.ok) return { ok: false, error: authz.error };
  const { companyId } = authz;

  const target = await prisma.user.findUnique({ where: { id: userId } });
  if (!target || target.companyId !== companyId) {
    return { ok: false, error: 'Utente non trovato nella tua azienda' };
  }

  const emailLower = normalizzaEmail(email);
  if (!emailLower || !/^[^@]+@[^@]+\.[^@]+$/.test(emailLower)) {
    return { ok: false, error: 'Email non valida' };
  }
  if (!nome.trim() || !cognome.trim()) {
    return { ok: false, error: 'Nome e cognome obbligatori' };
  }

  let permessiData: { permessi: string[] } | Record<string, never> = {};
  if (permessi !== undefined) {
    if (!authz.companyType) return { ok: false, error: 'Azienda senza tipo' };
    const val = validaPermessi({
      ctx: authz.permessiCtx,
      companyType: authz.companyType,
      richiesti: permessi,
      targetUserId: userId,
      targetRole: authz.targetRole,
    });
    if (!val.ok) return { ok: false, error: val.error };
    permessiData = { permessi: val.permessi };
  }

  if (emailLower !== target.email) {
    if (await emailGiaInUso(emailLower, { escludiUserId: userId })) {
      return { ok: false, error: EMAIL_GIA_IN_USO };
    }
  }

  // Multi-sede: aggiorna la membership (sede + ruolo) per gli UTENTE_AZIENDA. Il
  // proprietario (ADMIN_AZIENDA) ha accesso implicito a tutte le sedi → niente
  // membership. La sede deve appartenere all'azienda.
  const ruolo = ruoloSede ?? 'OPERATORE';
  const aggiornaMembership = target.role !== 'ADMIN_AZIENDA' && sedeId !== undefined;
  if (aggiornaMembership) {
    const sede = await prisma.sede.findFirst({
      where: { id: sedeId, companyId, deletedAt: null },
      select: { id: true },
    });
    if (!sede) return { ok: false, error: 'Sede non valida' };
    if (!authz.isOwner && !authz.manageableIds.includes(sedeId!)) {
      return { ok: false, error: 'Non puoi spostare l’utente su questa sede' };
    }
    // Difesa in profondità (coerente con authorizeTeamCreate): il ruolo assegnato
    // dev'essere tra quelli assegnabili dal chiamante sulla sede destinazione. A
    // questo punto il chiamante è OWNER (isOwner) oppure ADMIN_SEDE della sede
    // (garantito dal controllo manageableIds sopra) → entrambi assegnano
    // ADMIN_SEDE/OPERATORE; il guard blocca solo un ruolo runtime non valido.
    const callerRole: SedeRole = authz.isOwner ? 'OWNER' : 'ADMIN_SEDE';
    if (!assignableSedeRoles(callerRole).includes(ruolo)) {
      return { ok: false, error: 'Ruolo non assegnabile' };
    }
  }

  const scritto = await scriviUtente(() =>
    prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: { email: emailLower, nome: nome.trim(), cognome: cognome.trim(), ...permessiData },
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
    }),
  );
  if (!scritto.ok) return scritto;

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
  const gate = await gateCapability('team.reset_password', 'Non hai i permessi per resettare la password');
  if (gate) return gate;
  const authz = await authorizeTeamTargetUser(userId);
  if (!authz.ok) return { ok: false, error: authz.error };
  const { companyId } = authz;

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
  const gate = await gateCapability('team.disabilita', 'Non hai i permessi per disabilitare utenti');
  if (gate) return gate;

  // Il controllo capability precede questo: chi non ha team.disabilita deve
  // sentirsi dire che non ha il permesso, non che non può auto-eliminarsi.
  const ctx = await getSessionContext();
  if (ctx?.user?.id === userId) {
    return { ok: false, error: 'Non puoi eliminare il tuo stesso account' };
  }
  const authz = await authorizeTeamTargetUser(userId);
  if (!authz.ok) return { ok: false, error: authz.error };

  const target = await prisma.user.findUnique({ where: { id: userId } });
  if (!target || target.companyId !== authz.companyId) {
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

export type RevokeInviteResult = { ok: true } | { ok: false; error: string };

export async function revokeInvitationAction(invitationId: string): Promise<RevokeInviteResult> {
  // `gateCapability` e non `can(...)` inline (com'era): era l'unico dei sei gate
  // del modulo a rispondere «Non hai i permessi per revocare inviti» a un
  // sospeso, cioè esattamente la cosa che ERRORE_SOSPENSIONE esiste per evitare
  // — dire a un utente che gli mancano permessi che invece ha. La chiave resta
  // citata qui, così `mappa-enforcement.test.ts` la vede.
  const gate = await gateCapability('team.disabilita', 'Non hai i permessi per revocare inviti');
  if (gate) return gate;
  const ctx = await getSessionContext();
  if (!ctx?.companyId) return { ok: false, error: 'Non autenticato' };
  const manageable = manageableSedi({
    isOwner: ctx.isOwner,
    accessibleSedi: ctx.accessibleSedi,
    membershipRuoli: ctx.membershipRuoli,
  });
  const inv = await prisma.invitation.findUnique({ where: { id: invitationId } });
  if (!inv || inv.companyId !== ctx.companyId || inv.status !== 'PENDING') {
    return { ok: false, error: 'Invito non trovato o non più valido' };
  }
  if (!ctx.isOwner && (!inv.sedeId || !manageable.some((s) => s.id === inv.sedeId))) {
    return { ok: false, error: 'Non hai i permessi per revocare questo invito' };
  }
  await prisma.invitation.update({ where: { id: invitationId }, data: { status: 'REVOKED' } });
  revalidatePath('/team');
  return { ok: true };
}
