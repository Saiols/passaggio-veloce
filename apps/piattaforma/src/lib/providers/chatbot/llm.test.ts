import { describe, it, expect, vi, beforeEach } from 'vitest';

const create = vi.fn();
vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { create: (...a: unknown[]) => create(...a) };
  },
}));
vi.mock('@/env', () => ({ env: { ANTHROPIC_API_KEY: 'sk-test' } }));

import { respondWithLlm } from './llm';
import type { ChatbotConfig } from './index';

const bot: ChatbotConfig = {
  id: 'b1', nome: 'PVbot', prompt: 'Sei utile', obiettivo: 'aiutare',
  qa: '', escalation: 'Ti faccio richiamare.', attivo: true,
};

beforeEach(() => create.mockReset());

describe('respondWithLlm', () => {
  it('ritorna il testo del modello quando risponde', async () => {
    create.mockResolvedValue({ content: [{ type: 'text', text: 'La voltura costa 15€.' }] });
    const out = await respondWithLlm(bot, 'KB: prezzi voltura', [{ role: 'user', content: 'quanto costa?' }]);
    expect(out).toEqual({ reply: 'La voltura costa 15€.', escalated: false });
  });

  it('escalation quando il modello emette il sentinella di non-risposta', async () => {
    create.mockResolvedValue({ content: [{ type: 'text', text: '__NO_ANSWER__' }] });
    const out = await respondWithLlm(bot, 'KB', [{ role: 'user', content: 'ricetta carbonara?' }]);
    expect(out.escalated).toBe(true);
    expect(out.reply).toBe(bot.escalation);
  });

  it('passa la KB nel system con cache_control', async () => {
    create.mockResolvedValue({ content: [{ type: 'text', text: 'ok' }] });
    await respondWithLlm(bot, 'CONTENUTO_KB', [{ role: 'user', content: 'ciao' }]);
    const args = create.mock.calls[0]?.[0] as {
      model: string;
      system: { type: string; text: string; cache_control?: unknown }[];
    };
    expect(args.model).toBe('claude-haiku-4-5');
    const kbBlock = args.system.find((b) => b.text.includes('CONTENUTO_KB'));
    expect(kbBlock?.cache_control).toEqual({ type: 'ephemeral' });
  });
});
