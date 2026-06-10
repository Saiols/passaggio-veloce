import { describe, it, expect, vi, beforeEach } from 'vitest';

const upsert = vi.fn();
vi.mock('@pv/db', () => ({ prisma: { chatbotRateBucket: { upsert: (...a: unknown[]) => upsert(...a) } } }));
vi.mock('@/env', () => ({
  env: { CHATBOT_DAILY_CAP: 5000, CHATBOT_RATE_PER_MIN: 2, CHATBOT_RATE_PER_DAY_PER_IP: 5 },
}));

import { checkRateLimit } from './rate-limit';

// Helper: l'n-esima upsert ritorna { count } secondo la sequenza fornita.
function sequence(counts: number[]): void {
  let i = 0;
  upsert.mockImplementation(() => Promise.resolve({ count: counts[i++] ?? 1 }));
}

beforeEach(() => {
  upsert.mockReset();
});

describe('checkRateLimit', () => {
  it('consente sotto tutte le soglie', async () => {
    // ordine bump: ipMin, ipDay, global
    sequence([1, 1, 1]);
    const r = await checkRateLimit('1.2.3.4');
    expect(r).toEqual({ allowed: true, degraded: false });
  });

  it('blocca quando supera il limite per IP al minuto', async () => {
    sequence([3 /* > 2 */, 1, 1]);
    const r = await checkRateLimit('1.2.3.4');
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe('ip_minute');
  });

  it('blocca quando supera il limite giornaliero per IP', async () => {
    sequence([1, 6 /* > 5 */, 1]);
    const r = await checkRateLimit('1.2.3.4');
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe('ip_day');
  });

  it('degrada (non blocca) quando supera il tetto globale giornaliero', async () => {
    sequence([1, 1, 5001 /* > 5000 */]);
    const r = await checkRateLimit('1.2.3.4');
    expect(r).toEqual({ allowed: true, degraded: true, reason: 'global_day' });
  });
});
