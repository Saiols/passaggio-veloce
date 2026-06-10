import { describe, it, expect, vi, beforeEach } from 'vitest';

const { respondWithLlm, envMock } = vi.hoisted(() => ({
  respondWithLlm: vi.fn(),
  envMock: { CHATBOT_LLM_ENABLED: true as boolean, ANTHROPIC_API_KEY: 'sk' as string | undefined },
}));
vi.mock('./llm', () => ({ respondWithLlm: (...a: unknown[]) => respondWithLlm(...a) }));
vi.mock('./kb', () => ({ kbForTier: () => 'KB_FINTA' }));
vi.mock('@/env', () => ({ env: envMock }));

import { dispatchChat } from './dispatch';
import type { ChatbotConfig } from './index';

const bot: ChatbotConfig = {
  id: 'b1', nome: 'PVbot', prompt: 'p', obiettivo: 'o',
  qa: 'D: Quanto costa?\nR: Gratis.', escalation: 'Escalation.', attivo: true,
};

beforeEach(() => {
  respondWithLlm.mockReset();
  envMock.CHATBOT_LLM_ENABLED = true;
  envMock.ANTHROPIC_API_KEY = 'sk';
});

describe('dispatchChat', () => {
  it('usa LLM quando abilitato, key presente e non over-budget', async () => {
    respondWithLlm.mockResolvedValue({ reply: 'da LLM', escalated: false });
    const out = await dispatchChat({
      bot, tier: 'public', history: [{ role: 'user', content: 'quanto costa?' }], overBudget: false,
    });
    expect(out).toEqual({ reply: 'da LLM', escalated: false, usedLlm: true });
  });

  it('fallback deterministico quando LLM disabilitato', async () => {
    envMock.CHATBOT_LLM_ENABLED = false;
    const out = await dispatchChat({
      bot, tier: 'public', history: [{ role: 'user', content: 'quanto costa?' }], overBudget: false,
    });
    expect(out.usedLlm).toBe(false);
    expect(out.reply).toBe('Gratis.'); // dallo stub respondAsBot
  });

  it('fallback deterministico quando over-budget', async () => {
    const out = await dispatchChat({
      bot, tier: 'public', history: [{ role: 'user', content: 'quanto costa?' }], overBudget: true,
    });
    expect(out.usedLlm).toBe(false);
    expect(respondWithLlm).not.toHaveBeenCalled();
  });

  it('fallback deterministico se la chiamata LLM lancia', async () => {
    respondWithLlm.mockRejectedValue(new Error('api down'));
    const out = await dispatchChat({
      bot, tier: 'public', history: [{ role: 'user', content: 'quanto costa?' }], overBudget: false,
    });
    expect(out.usedLlm).toBe(false);
    expect(out.reply).toBe('Gratis.');
  });
});
