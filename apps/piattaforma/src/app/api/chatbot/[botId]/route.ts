import { NextResponse } from 'next/server';
import { prisma } from '@pv/db';
import { resolveTier } from '@/lib/providers/chatbot/tier-server';
import { checkRateLimit } from '@/lib/providers/chatbot/rate-limit';
import { dispatchChat, type ChatMessage } from '@/lib/providers/chatbot/dispatch';
import { logInteraction } from '@/lib/providers/chatbot/log';
import { getClientIp } from '@/lib/rate-limit/client-ip';

const MAX_HISTORY = 12;
const MAX_MSG_LEN = 1000;

export async function POST(req: Request, ctx: { params: Promise<{ botId: string }> }) {
  const { botId } = await ctx.params;

  let body: { messages?: { role?: string; content?: string }[]; message?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'JSON non valido' }, { status: 400 });
  }

  // Normalizza: accetta {messages:[...]} (multi-turn) o {message:"..."} (legacy).
  let history: ChatMessage[] = Array.isArray(body.messages)
    ? body.messages
        .filter(
          (m): m is { role: 'user' | 'assistant'; content: string } =>
            (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string',
        )
        .map((m) => ({ role: m.role, content: m.content.slice(0, MAX_MSG_LEN) }))
    : [];
  if (history.length === 0 && typeof body.message === 'string') {
    history = [{ role: 'user', content: body.message.slice(0, MAX_MSG_LEN) }];
  }
  history = history.slice(-MAX_HISTORY);
  if (history.length === 0 || history[history.length - 1]?.role !== 'user') {
    return NextResponse.json({ error: 'Nessun messaggio utente' }, { status: 400 });
  }

  // Rate-limit (prima di tutto, anche prima del DB lookup del bot).
  // getClientIp (M3): preferisce x-real-ip, altrimenti l'ULTIMO valore di
  // x-forwarded-for (non il primo, falsificabile dal client).
  const rate = await checkRateLimit(getClientIp(req.headers));
  if (!rate.allowed) {
    return NextResponse.json(
      {
        reply: 'Sto ricevendo molte richieste in questo momento. Riprova tra poco.',
        escalated: true,
      },
      { status: 429 },
    );
  }

  // Tier SEMPRE lato server, mai dal client.
  const tier = await resolveTier();

  const bot = await prisma.crmChatbot.findFirst({
    where: { id: botId, deletedAt: null, attivo: true },
    select: {
      id: true,
      nome: true,
      prompt: true,
      obiettivo: true,
      qa: true,
      escalation: true,
      attivo: true,
    },
  });
  if (!bot) {
    return NextResponse.json({ error: 'Bot non disponibile' }, { status: 404 });
  }

  const out = await dispatchChat({ bot, tier, history, overBudget: rate.degraded });

  const lastUser = [...history].reverse().find((m) => m.role === 'user')?.content;
  void logInteraction({
    tier,
    answered: !out.escalated,
    escalated: out.escalated,
    question: lastUser,
  });

  return NextResponse.json({ reply: out.reply, escalated: out.escalated });
}
