/**
 * Rate limit in-memory per endpoint sensibili (login, reset password, ecc.).
 *
 * Implementazione: sliding window con Map. Swap-ready a Redis quando il
 * traffico richiede multi-istanza (Vercel auto-scaling) — basta sostituire
 * la Map con un'istanza Redis e mantenere la stessa firma `check(key)`.
 *
 * Default: max 5 tentativi in 15 minuti per chiave. Dopo il limite, la
 * chiave è bloccata per ulteriori 15 minuti.
 */

type Record = {
  attempts: number[];
  blockedUntil: number;
};

const store = new Map<string, Record>();

const WINDOW_MS = 15 * 60_000; // 15 minuti
const MAX_ATTEMPTS = 5;
const BLOCK_DURATION_MS = 15 * 60_000;

export type RateLimitResult =
  | { allowed: true; remaining: number }
  | { allowed: false; retryAfterSeconds: number };

/**
 * Registra un tentativo per la chiave. Ritorna se è permesso e quanti
 * tentativi restano nella finestra. Se bloccato, il chiamante deve
 * rifiutare la richiesta (HTTP 429 o equivalente UX).
 */
export function checkRateLimit(key: string): RateLimitResult {
  const now = Date.now();
  const rec = store.get(key) ?? { attempts: [], blockedUntil: 0 };

  if (rec.blockedUntil > now) {
    return {
      allowed: false,
      retryAfterSeconds: Math.ceil((rec.blockedUntil - now) / 1000),
    };
  }

  // Pulisce tentativi fuori finestra
  rec.attempts = rec.attempts.filter((t) => now - t < WINDOW_MS);

  if (rec.attempts.length >= MAX_ATTEMPTS) {
    rec.blockedUntil = now + BLOCK_DURATION_MS;
    rec.attempts = [];
    store.set(key, rec);
    return {
      allowed: false,
      retryAfterSeconds: Math.ceil(BLOCK_DURATION_MS / 1000),
    };
  }

  rec.attempts.push(now);
  store.set(key, rec);

  return {
    allowed: true,
    remaining: MAX_ATTEMPTS - rec.attempts.length,
  };
}

/**
 * Resetta il contatore per una chiave (es. dopo login riuscito).
 */
export function resetRateLimit(key: string): void {
  store.delete(key);
}

/**
 * Periodic cleanup: rimuove record scaduti per evitare memory leak.
 * Chiamabile da un cron in futuro; oggi best-effort dentro `checkRateLimit`.
 */
export function gcRateLimit(): { cleaned: number } {
  const now = Date.now();
  let cleaned = 0;
  for (const [key, rec] of store.entries()) {
    if (
      rec.blockedUntil < now &&
      rec.attempts.every((t) => now - t > WINDOW_MS)
    ) {
      store.delete(key);
      cleaned++;
    }
  }
  return { cleaned };
}
