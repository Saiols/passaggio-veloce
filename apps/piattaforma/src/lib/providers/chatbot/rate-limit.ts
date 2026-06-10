import { prisma } from '@pv/db';
import { env } from '@/env';

export type RateDecision =
  | { allowed: true; degraded: false; reason?: undefined }
  | { allowed: true; degraded: true; reason: 'global_day' }
  | { allowed: false; degraded: false; reason: 'ip_minute' | 'ip_day' };

function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
}
function minuteKey(d: Date): string {
  return d.toISOString().slice(0, 16); // YYYY-MM-DDTHH:mm
}

/** Incrementa atomicamente un bucket e ritorna il nuovo conteggio. */
async function bump(key: string, ttlMs: number, now: Date): Promise<number> {
  const expiresAt = new Date(now.getTime() + ttlMs);
  const row = await prisma.chatbotRateBucket.upsert({
    where: { key },
    create: { key, count: 1, expiresAt },
    update: { count: { increment: 1 } },
  });
  return row.count;
}

/**
 * Applica i limiti nell'ordine: per-IP/min, per-IP/giorno, globale/giorno.
 * - superato un limite per-IP → block (la route risponde "riprova").
 * - superato il tetto globale → degrade (la route procede col fallback deterministico).
 */
export async function checkRateLimit(ip: string, now: Date = new Date()): Promise<RateDecision> {
  const day = dayKey(now);
  const min = minuteKey(now);
  const DAY_MS = 36 * 60 * 60 * 1000; // > 24h, cleanup tollerante
  const MIN_MS = 2 * 60 * 1000;

  const ipMin = await bump(`ipmin:${ip}:${min}`, MIN_MS, now);
  if (ipMin > env.CHATBOT_RATE_PER_MIN) return { allowed: false, degraded: false, reason: 'ip_minute' };

  const ipDay = await bump(`ipday:${ip}:${day}`, DAY_MS, now);
  if (ipDay > env.CHATBOT_RATE_PER_DAY_PER_IP) return { allowed: false, degraded: false, reason: 'ip_day' };

  const global = await bump(`global:${day}`, DAY_MS, now);
  if (global > env.CHATBOT_DAILY_CAP) return { allowed: true, degraded: true, reason: 'global_day' };

  return { allowed: true, degraded: false };
}
