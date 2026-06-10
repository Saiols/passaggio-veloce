import { describe, it, expect, vi, beforeEach } from 'vitest';

const create = vi.fn((_a: unknown) => Promise.resolve({}));
vi.mock('@pv/db', () => ({ prisma: { chatbotInteraction: { create: (a: unknown) => create(a) } } }));

import { logInteraction } from './log';

beforeEach(() => create.mockClear());

describe('logInteraction', () => {
  it('quando answered=true non salva la domanda', async () => {
    await logInteraction({ tier: 'public', answered: true, escalated: false, question: 'ciao' });
    expect(create).toHaveBeenCalledWith({
      data: { tier: 'public', answered: true, escalated: false, unansweredQuestion: null },
    });
  });

  it('quando answered=false salva la domanda troncata a 500 char', async () => {
    const long = 'x'.repeat(600);
    await logInteraction({ tier: 'clients', answered: false, escalated: true, question: long });
    const arg = (create.mock.calls[0] as unknown as [{ data: { unansweredQuestion: string } }])[0];
    expect(arg.data.unansweredQuestion).toHaveLength(500);
  });

  it('non lancia se prisma fallisce (best-effort)', async () => {
    create.mockRejectedValueOnce(new Error('db down'));
    await expect(
      logInteraction({ tier: 'public', answered: true, escalated: false }),
    ).resolves.toBeUndefined();
  });
});
