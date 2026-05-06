import { prisma } from '@pv/db';
import { ChatbotWidget } from './chatbot-widget';

/**
 * Server wrapper: cerca un chatbot SITO (o TUTTI) attivo che matchi
 * la posizione richiesta e renderizza il widget. Se nessuno è
 * configurato, ritorna null.
 *
 * Spec D-09: chatbot embed = component inline nella stessa Next app,
 * niente iframe/script embeddable.
 */
export async function SiteChatbot({
  posizione,
}: {
  posizione: string;
}) {
  const bot = await prisma.crmChatbot.findFirst({
    where: {
      deletedAt: null,
      attivo: true,
      canale: { in: ['SITO', 'TUTTI'] },
      OR: [{ posizione }, { posizione: null }],
    },
    orderBy: [{ posizione: 'desc' }, { createdAt: 'desc' }],
    select: { id: true, nome: true, prompt: true },
  });
  if (!bot) return null;

  // Greeting iniziale: prima riga del prompt o fallback canonico.
  const greeting = bot.prompt.split(/\r?\n/)[0]?.trim() ||
    `Ciao, sono ${bot.nome}. Come posso aiutarti?`;

  return (
    <ChatbotWidget
      botId={bot.id}
      botNome={bot.nome}
      greeting={greeting}
    />
  );
}
