import { prisma } from '@pv/db';
import type { Tier } from './tier';

/**
 * Logga una metrica di interazione. Best-effort: non deve MAI rompere la
 * risposta del bot. Salva la domanda solo se senza risposta (troncata).
 */
export async function logInteraction(opts: {
  tier: Tier;
  answered: boolean;
  escalated: boolean;
  question?: string;
}): Promise<void> {
  try {
    await prisma.chatbotInteraction.create({
      data: {
        tier: opts.tier,
        answered: opts.answered,
        escalated: opts.escalated,
        unansweredQuestion: opts.answered ? null : (opts.question ?? '').slice(0, 500),
      },
    });
  } catch {
    // logging best-effort
  }
}
