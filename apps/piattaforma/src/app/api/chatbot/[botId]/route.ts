import { NextResponse } from 'next/server';
import { prisma } from '@pv/db';
import { respondAsBot } from '@/lib/providers/chatbot';

export async function POST(
  req: Request,
  ctx: { params: Promise<{ botId: string }> },
) {
  const { botId } = await ctx.params;

  let body: { message?: string };
  try {
    body = (await req.json()) as { message?: string };
  } catch {
    return NextResponse.json({ error: 'JSON non valido' }, { status: 400 });
  }
  const message = (body.message ?? '').slice(0, 1000);

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

  const out = respondAsBot(bot, message);
  return NextResponse.json(out);
}
