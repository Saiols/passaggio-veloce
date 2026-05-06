'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { prisma, Prisma } from '@pv/db';
import {
  canManageSalesAgent,
  canViewSales,
  canManageCrmCampaign,
} from '@/lib/auth/permissions';

// ════════════════════════════════════════════════════════
// SALES AGENT
// ════════════════════════════════════════════════════════
const AGENT_SCHEMA = z.object({
  nome: z.string().trim().min(2).max(120),
  lingua: z.enum(['ITALIANO', 'ENGLISH', 'ESPANOL']),
  voce: z.enum(['FEMMINILE_NATURALE', 'MASCHILE_NATURALE', 'CLONATA']),
  accento: z.enum([
    'NEUTRO_ITALIANO',
    'NORD_ITALIA',
    'CENTRO_ITALIA',
    'SUD_ITALIA',
  ]),
  prompt: z.string().trim().min(10).max(8000),
  scriptPrimo: z.string().trim().min(10).max(4000),
  scriptFollowup: z.string().trim().min(10).max(4000),
  qa: z.string().trim().max(8000).default(''),
  postCall: z.string().trim().max(4000).default(''),
});
export type SalesAgentInput = z.infer<typeof AGENT_SCHEMA>;

export type AgentResult = { ok: true; id: string } | { ok: false; error: string };

export async function createSalesAgentAction(
  raw: unknown,
): Promise<AgentResult> {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if (!canManageSalesAgent(session.user.role)) {
    return { ok: false, error: 'Non hai i permessi per creare agent CRM' };
  }
  const parsed = AGENT_SCHEMA.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return {
      ok: false,
      error: first ? `${first.path.join('.')}: ${first.message}` : 'Dati non validi',
    };
  }
  const created = await prisma.crmSalesAgent.create({
    data: parsed.data,
    select: { id: true },
  });
  revalidatePath('/admin/crm/sales');
  return { ok: true, id: created.id };
}

export async function updateSalesAgentAction(
  id: string,
  raw: unknown,
): Promise<AgentResult> {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if (!canManageSalesAgent(session.user.role)) {
    return { ok: false, error: 'Non hai i permessi per modificare agent CRM' };
  }
  const parsed = AGENT_SCHEMA.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return {
      ok: false,
      error: first ? `${first.path.join('.')}: ${first.message}` : 'Dati non validi',
    };
  }
  await prisma.crmSalesAgent.update({
    where: { id },
    data: parsed.data,
  });
  revalidatePath('/admin/crm/sales');
  return { ok: true, id };
}

export async function deleteSalesAgentAction(
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if (!canManageSalesAgent(session.user.role)) {
    return { ok: false, error: 'Non hai i permessi per eliminare agent CRM' };
  }
  // Decisione 8: blocca delete se l'agent ha campagne ATTIVA o PAUSATA
  const activeCount = await prisma.crmCampaign.count({
    where: {
      agentId: id,
      status: { in: ['ATTIVA', 'PAUSATA'] },
      deletedAt: null,
    },
  });
  if (activeCount > 0) {
    return {
      ok: false,
      error: `Agent in uso in ${activeCount} campagn${
        activeCount === 1 ? 'a' : 'e'
      } attive/pausate. Chiudile prima di eliminare.`,
    };
  }
  await prisma.crmSalesAgent.update({
    where: { id },
    data: { deletedAt: new Date() },
  });
  revalidatePath('/admin/crm/sales');
  return { ok: true };
}

// ════════════════════════════════════════════════════════
// CAMPAIGN
// ════════════════════════════════════════════════════════
const CAMPAIGN_SCHEMA = z.object({
  nome: z.string().trim().min(2).max(160),
  agentId: z.string().uuid(),
  regione: z.string().trim().max(40).optional().or(z.literal('')),
  cat: z.enum(['BROKER', 'AGENZIA']).optional().or(z.literal('')),
  statoTarget: z
    .enum(['S0', 'S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8', 'S9', 'S10'])
    .optional()
    .or(z.literal('')),
  maxTry: z.coerce.number().int().min(1).max(10).default(3),
  intervalMin: z.coerce.number().int().min(15).max(1440).default(60),
  oraStart: z.string().regex(/^\d{2}:\d{2}$/).default('09:00'),
  oraEnd: z.string().regex(/^\d{2}:\d{2}$/).default('18:00'),
  giorniAttivi: z.enum(['LUN_VEN', 'LUN_SAB', 'TUTTI']).default('LUN_VEN'),
  status: z.enum(['ATTIVA', 'PAUSATA', 'CHIUSA']).default('ATTIVA'),
  note: z.string().trim().max(2000).optional().or(z.literal('')),
});
export type CampaignInput = z.infer<typeof CAMPAIGN_SCHEMA>;

export type CampaignResult =
  | { ok: true; id: string; assegnati: number }
  | { ok: false; error: string };

function emptyToUndef<T>(v: T | ''): T | undefined {
  return v === '' || v === undefined ? undefined : (v as T);
}

/**
 * Lancio campagna: crea record CrmCampaign + popola
 * CrmCampaignAssegnazione con i CrmContact che matchano i filtri al
 * momento del lancio. Owner = currentUser (decisione 6).
 */
export async function createCampaignAction(
  raw: unknown,
): Promise<CampaignResult> {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if (!canViewSales(session.user.role)) {
    return { ok: false, error: 'Non hai i permessi per creare campagne CRM' };
  }
  const parsed = CAMPAIGN_SCHEMA.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return {
      ok: false,
      error: first ? `${first.path.join('.')}: ${first.message}` : 'Dati non validi',
    };
  }
  const d = parsed.data;

  // Match contatti per filtri al momento del lancio
  const where: Prisma.CrmContactWhereInput = { deletedAt: null };
  const cat = emptyToUndef(d.cat);
  const stato = emptyToUndef(d.statoTarget);
  const regione = emptyToUndef(d.regione);
  if (cat) where.cat = cat;
  if (stato) where.status = stato;
  if (regione) where.regione = regione;

  const matchingContacts = await prisma.crmContact.findMany({
    where,
    select: { id: true },
  });

  // Transazione: create campagna + bulk-create assegnazioni
  const created = await prisma.$transaction(async (tx) => {
    const camp = await tx.crmCampaign.create({
      data: {
        nome: d.nome,
        agentId: d.agentId,
        ownerId: session.user!.id!,
        regione: regione ?? null,
        cat: cat ?? null,
        statoTarget: stato ?? null,
        maxTry: d.maxTry,
        intervalMin: d.intervalMin,
        oraStart: d.oraStart,
        oraEnd: d.oraEnd,
        giorniAttivi: d.giorniAttivi,
        status: d.status,
        note: emptyToUndef(d.note) ?? null,
      },
      select: { id: true },
    });
    if (matchingContacts.length > 0) {
      await tx.crmCampaignAssegnazione.createMany({
        data: matchingContacts.map((c) => ({
          campaignId: camp.id,
          contactId: c.id,
        })),
        skipDuplicates: true,
      });
    }
    return camp;
  });

  revalidatePath('/admin/crm/sales');
  return { ok: true, id: created.id, assegnati: matchingContacts.length };
}

export async function updateCampaignAction(
  id: string,
  raw: unknown,
): Promise<CampaignResult> {
  const session = await auth();
  if (!session?.user) redirect('/login');

  const target = await prisma.crmCampaign.findUnique({
    where: { id },
    select: { ownerId: true },
  });
  if (!target) return { ok: false, error: 'Campagna non trovata' };
  if (
    !canManageCrmCampaign(session.user.role, target.ownerId, session.user.id)
  ) {
    return { ok: false, error: 'Non puoi modificare questa campagna' };
  }

  const parsed = CAMPAIGN_SCHEMA.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return {
      ok: false,
      error: first ? `${first.path.join('.')}: ${first.message}` : 'Dati non validi',
    };
  }
  const d = parsed.data;

  await prisma.crmCampaign.update({
    where: { id },
    data: {
      nome: d.nome,
      agentId: d.agentId,
      regione: emptyToUndef(d.regione) ?? null,
      cat: emptyToUndef(d.cat) ?? null,
      statoTarget: emptyToUndef(d.statoTarget) ?? null,
      maxTry: d.maxTry,
      intervalMin: d.intervalMin,
      oraStart: d.oraStart,
      oraEnd: d.oraEnd,
      giorniAttivi: d.giorniAttivi,
      status: d.status,
      note: emptyToUndef(d.note) ?? null,
    },
  });
  revalidatePath('/admin/crm/sales');
  // Update non re-assegna contatti (i nuovi match con filtri diversi non
  // diventano automaticamente assegnati — è un'operazione manuale separata).
  return { ok: true, id, assegnati: 0 };
}

export async function setCampaignStatusAction(
  id: string,
  status: 'ATTIVA' | 'PAUSATA' | 'CHIUSA',
): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await auth();
  if (!session?.user) redirect('/login');

  const target = await prisma.crmCampaign.findUnique({
    where: { id },
    select: { ownerId: true },
  });
  if (!target) return { ok: false, error: 'Campagna non trovata' };
  if (
    !canManageCrmCampaign(session.user.role, target.ownerId, session.user.id)
  ) {
    return { ok: false, error: 'Non puoi modificare questa campagna' };
  }

  await prisma.crmCampaign.update({
    where: { id },
    data: { status },
  });
  revalidatePath('/admin/crm/sales');
  return { ok: true };
}

export async function deleteCampaignAction(
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await auth();
  if (!session?.user) redirect('/login');

  const target = await prisma.crmCampaign.findUnique({
    where: { id },
    select: { ownerId: true },
  });
  if (!target) return { ok: false, error: 'Campagna non trovata' };
  if (
    !canManageCrmCampaign(session.user.role, target.ownerId, session.user.id)
  ) {
    return { ok: false, error: 'Non puoi eliminare questa campagna' };
  }

  await prisma.crmCampaign.update({
    where: { id },
    data: { deletedAt: new Date(), status: 'CHIUSA' },
  });
  revalidatePath('/admin/crm/sales');
  return { ok: true };
}
