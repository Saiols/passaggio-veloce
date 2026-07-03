import { env } from '@/env';
import { respondAsBot, type ChatbotConfig, type ChatbotReply } from './index';
import { respondWithLlm, type ChatMessage } from './llm';
import { kbForTier } from './kb';
import type { Tier } from './tier';
import { getTariffarioCorrente } from '@/lib/tariffario';
import { buildListinoBlock } from './listino-block';

export type { ChatMessage };
export type DispatchResult = ChatbotReply & { usedLlm: boolean };

/**
 * Decide LLM vs fallback deterministico e ritorna la risposta.
 * Catena fail-open: LLM solo se abilitato + key presente + non over-budget;
 * su qualsiasi problema → respondAsBot (stub keyword), mai un errore al client.
 */
export async function dispatchChat(opts: {
  bot: ChatbotConfig;
  tier: Tier;
  history: ChatMessage[];
  overBudget: boolean;
}): Promise<DispatchResult> {
  const lastUser = [...opts.history].reverse().find((m) => m.role === 'user');
  const message = lastUser?.content ?? '';

  const llmReady = env.CHATBOT_LLM_ENABLED && !!env.ANTHROPIC_API_KEY && !opts.overBudget;
  if (!llmReady) {
    return { ...respondAsBot(opts.bot, message), usedLlm: false };
  }

  try {
    const listinoBlock =
      opts.tier === 'public' ? undefined : buildListinoBlock(await getTariffarioCorrente());
    const out = await respondWithLlm(opts.bot, kbForTier(opts.tier), opts.history, listinoBlock);
    return { ...out, usedLlm: true };
  } catch {
    return { ...respondAsBot(opts.bot, message), usedLlm: false };
  }
}
