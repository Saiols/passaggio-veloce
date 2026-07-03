import { describe, it, expect, vi, beforeEach } from 'vitest';

const { respondWithLlm, envMock } = vi.hoisted(() => ({
  respondWithLlm: vi.fn(),
  envMock: { CHATBOT_LLM_ENABLED: true as boolean, ANTHROPIC_API_KEY: 'sk' as string | undefined },
}));
vi.mock('./llm', () => ({ respondWithLlm: (...a: unknown[]) => respondWithLlm(...a) }));
vi.mock('./kb', () => ({ kbForTier: () => 'KB_FINTA' }));
vi.mock('@/env', () => ({ env: envMock }));
vi.mock('@/lib/tariffario', () => ({ getTariffarioCorrente: vi.fn().mockResolvedValue({
  SEMPLICE: { feeAgenziaCent: 7500, creditoBrokerCent: 2500, affiliazioneCent: 1000 },
  MINIVOLTURA: { feeAgenziaCent: 1500, creditoBrokerCent: 0, affiliazioneCent: 500 },
}) }));
vi.mock('./listino-block', () => ({ buildListinoBlock: () => 'LISTINO_BLOCK' }));

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

  it('inietta il listino per tier clients, non per public', async () => {
    respondWithLlm.mockResolvedValue({ reply: 'ok', escalated: false });

    await dispatchChat({ bot, tier: 'clients', history: [{ role: 'user', content: 'quanto costa?' }], overBudget: false });
    expect(respondWithLlm).toHaveBeenLastCalledWith(bot, 'KB_FINTA', expect.anything(), 'LISTINO_BLOCK');

    await dispatchChat({ bot, tier: 'public', history: [{ role: 'user', content: 'quanto costa?' }], overBudget: false });
    expect(respondWithLlm).toHaveBeenLastCalledWith(bot, 'KB_FINTA', expect.anything(), undefined);
  });
});
