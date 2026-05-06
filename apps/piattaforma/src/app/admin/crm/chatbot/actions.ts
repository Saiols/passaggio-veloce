'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { prisma } from '@pv/db';
import { canManageChatbot } from '@/lib/auth/permissions';

const CHATBOT_SCHEMA = z.object({
  nome: z.string().trim().min(2).max(160),
  target: z.enum(['BROKER', 'AGENZIA']).optional().or(z.literal('')),
  canale: z.enum(['SITO', 'WHATSAPP', 'MAIL', 'TUTTI']),
  posizione: z.string().trim().max(160).optional().or(z.literal('')),
  attivo: z.boolean().default(true),
  prompt: z.string().trim().min(10).max(4000),
  obiettivo: z.string().trim().min(5).max(2000),
  qa: z.string().trim().max(8000).default(''),
  escalation: z.string().trim().min(5).max(1000),
});

export type ChatbotInput = z.infer<typeof CHATBOT_SCHEMA>;

export type ChatbotResult =
  | { ok: true; id: string }
  | { ok: false; error: string };

function parseError(err: z.SafeParseReturnType<unknown, unknown>): string {
  if (err.success) return 'Dati non validi';
  const first = err.error.issues[0];
  return first ? `${first.path.join('.')}: ${first.message}` : 'Dati non validi';
}

export async function createChatbotAction(
  raw: unknown,
): Promise<ChatbotResult> {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if (!canManageChatbot(session.user.role)) {
    return { ok: false, error: 'Non hai i permessi per creare chatbot' };
  }

  const parsed = CHATBOT_SCHEMA.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parseError(parsed) };
  const d = parsed.data;

  const created = await prisma.crmChatbot.create({
    data: {
      nome: d.nome,
      target: d.target ? (d.target as 'BROKER' | 'AGENZIA') : null,
      canale: d.canale,
      posizione: d.posizione || null,
      attivo: d.attivo,
      prompt: d.prompt,
      obiettivo: d.obiettivo,
      qa: d.qa,
      escalation: d.escalation,
    },
    select: { id: true },
  });

  revalidatePath('/admin/crm/chatbot');
  return { ok: true, id: created.id };
}

export async function updateChatbotAction(
  id: string,
  raw: unknown,
): Promise<ChatbotResult> {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if (!canManageChatbot(session.user.role)) {
    return { ok: false, error: 'Non hai i permessi per modificare chatbot' };
  }

  const target = await prisma.crmChatbot.findUnique({
    where: { id },
    select: { id: true, deletedAt: true },
  });
  if (!target || target.deletedAt) {
    return { ok: false, error: 'Chatbot non trovato' };
  }

  const parsed = CHATBOT_SCHEMA.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parseError(parsed) };
  const d = parsed.data;

  await prisma.crmChatbot.update({
    where: { id },
    data: {
      nome: d.nome,
      target: d.target ? (d.target as 'BROKER' | 'AGENZIA') : null,
      canale: d.canale,
      posizione: d.posizione || null,
      attivo: d.attivo,
      prompt: d.prompt,
      obiettivo: d.obiettivo,
      qa: d.qa,
      escalation: d.escalation,
    },
  });

  revalidatePath('/admin/crm/chatbot');
  return { ok: true, id };
}

export async function toggleChatbotActiveAction(
  id: string,
  attivo: boolean,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if (!canManageChatbot(session.user.role)) {
    return { ok: false, error: 'Non hai i permessi' };
  }

  const target = await prisma.crmChatbot.findUnique({
    where: { id },
    select: { id: true, deletedAt: true },
  });
  if (!target || target.deletedAt) {
    return { ok: false, error: 'Chatbot non trovato' };
  }

  await prisma.crmChatbot.update({ where: { id }, data: { attivo } });
  revalidatePath('/admin/crm/chatbot');
  return { ok: true };
}

export async function deleteChatbotAction(
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if (!canManageChatbot(session.user.role)) {
    return { ok: false, error: 'Non hai i permessi per eliminare chatbot' };
  }

  await prisma.crmChatbot.update({
    where: { id },
    data: { deletedAt: new Date(), attivo: false },
  });

  revalidatePath('/admin/crm/chatbot');
  return { ok: true };
}
