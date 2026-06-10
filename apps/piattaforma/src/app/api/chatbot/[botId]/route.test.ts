import { describe, it, expect, vi, beforeEach } from 'vitest';

const findFirst = vi.fn<(...a: unknown[]) => unknown>();
const checkRateLimit = vi.fn<(...a: unknown[]) => unknown>();
const resolveTier = vi.fn<(...a: unknown[]) => unknown>();
const dispatchChat = vi.fn<(...a: unknown[]) => unknown>();
const logInteraction = vi.fn<(...a: unknown[]) => unknown>(() => Promise.resolve());

vi.mock('@pv/db', () => ({ prisma: { crmChatbot: { findFirst: (...a: unknown[]) => findFirst(...a) } } }));
vi.mock('@/lib/providers/chatbot/rate-limit', () => ({ checkRateLimit: (...a: unknown[]) => checkRateLimit(...a) }));
vi.mock('@/lib/providers/chatbot/tier-server', () => ({ resolveTier: (...a: unknown[]) => resolveTier(...a) }));
vi.mock('@/lib/providers/chatbot/dispatch', () => ({ dispatchChat: (...a: unknown[]) => dispatchChat(...a) }));
vi.mock('@/lib/providers/chatbot/log', () => ({ logInteraction: (...a: unknown[]) => logInteraction(...a) }));

import { POST } from './route';

const ctx = { params: Promise.resolve({ botId: 'bot-1' }) };
function reqWith(body: unknown): Request {
  return new Request('http://localhost/api/chatbot/bot-1', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '9.9.9.9' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  findFirst.mockReset();
  checkRateLimit.mockReset();
  resolveTier.mockReset();
  dispatchChat.mockReset();
  logInteraction.mockClear();
  checkRateLimit.mockResolvedValue({ allowed: true, degraded: false });
  resolveTier.mockResolvedValue('public');
  findFirst.mockResolvedValue({
    id: 'bot-1', nome: 'PVbot', prompt: 'p', obiettivo: 'o', qa: '', escalation: 'esc', attivo: true,
  });
  dispatchChat.mockResolvedValue({ reply: 'risposta', escalated: false, usedLlm: true });
});

describe('POST /api/chatbot/[botId]', () => {
  it('risponde 200 con reply per un messaggio valido', async () => {
    const res = await POST(reqWith({ messages: [{ role: 'user', content: 'ciao' }] }), ctx);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ reply: 'risposta', escalated: false });
  });

  it('risolve il tier lato server e lo passa al dispatcher', async () => {
    resolveTier.mockResolvedValue('clients');
    await POST(reqWith({ messages: [{ role: 'user', content: 'ciao' }] }), ctx);
    expect(dispatchChat).toHaveBeenCalledWith(expect.objectContaining({ tier: 'clients' }));
  });

  it('429 quando il rate-limit blocca', async () => {
    checkRateLimit.mockResolvedValue({ allowed: false, degraded: false, reason: 'ip_minute' });
    const res = await POST(reqWith({ messages: [{ role: 'user', content: 'ciao' }] }), ctx);
    expect(res.status).toBe(429);
    expect(dispatchChat).not.toHaveBeenCalled();
  });

  it('propaga overBudget=true quando degraded', async () => {
    checkRateLimit.mockResolvedValue({ allowed: true, degraded: true, reason: 'global_day' });
    await POST(reqWith({ messages: [{ role: 'user', content: 'ciao' }] }), ctx);
    expect(dispatchChat).toHaveBeenCalledWith(expect.objectContaining({ overBudget: true }));
  });

  it('accetta il formato legacy {message}', async () => {
    const res = await POST(reqWith({ message: 'ciao' }), ctx);
    expect(res.status).toBe(200);
  });

  it('400 se non c\'è un messaggio utente', async () => {
    const res = await POST(reqWith({ messages: [] }), ctx);
    expect(res.status).toBe(400);
  });

  it('404 se il bot non esiste', async () => {
    findFirst.mockResolvedValue(null);
    const res = await POST(reqWith({ messages: [{ role: 'user', content: 'ciao' }] }), ctx);
    expect(res.status).toBe(404);
  });
});
