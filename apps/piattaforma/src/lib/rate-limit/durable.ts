import { prisma } from '@pv/db';

/**
 * Rate limiter durevole (DB-backed), generalizzazione del pattern già in
 * produzione per il chatbot (lib/providers/chatbot/rate-limit.ts). Sostituisce
 * gli in-memory Map (utili in un solo processo, inutili su Vercel serverless:
 * ogni istanza/cold-start riparte da zero) con un contatore in Postgres.
 *
 * Design a finestra fissa su una chiave stabile (non a differenza del chatbot,
 * che incorpora la finestra nella chiave stessa): la riga esiste per `key`,
 * `expiresAt` ne segna la scadenza. Se la riga è assente o scaduta si resetta
 * (count=1, nuova finestra), altrimenti si incrementa e si confronta col
 * limite. Le due operazioni (lettura + scrittura) non sono in una singola
 * transazione DB: sotto concorrenza estrema al bordo esatto della finestra è
 * possibile un conteggio leggermente impreciso — accettabile qui perché i
 * limiti sono deliberatamente larghi (vedi chiamanti) e comunque MAI usati per
 * bloccare in modo esatto, solo per scoraggiare abusi grossolani.
 *
 * FAIL-OPEN: qualunque errore (DB giù, connessione, timeout, tabella non
 * ancora migrata, ecc.) fa ritornare `{ allowed: true }`. Il limiter non deve
 * MAI diventare un motivo per cui un utente legittimo resta fuori: meglio
 * lasciar passare tutto in caso di guasto del limiter stesso.
 */
export type RateLimitResult = { allowed: boolean };

export async function rateLimit(
  key: string,
  limit: number,
  windowSec: number,
): Promise<RateLimitResult> {
  try {
    const now = new Date();
    const existing = await prisma.rateBucket.findUnique({ where: { key } });

    if (!existing || existing.expiresAt <= now) {
      const expiresAt = new Date(now.getTime() + windowSec * 1000);
      await prisma.rateBucket.upsert({
        where: { key },
        create: { key, count: 1, expiresAt },
        update: { count: 1, expiresAt },
      });
      return { allowed: true };
    }

    const updated = await prisma.rateBucket.update({
      where: { key },
      data: { count: { increment: 1 } },
    });
    return { allowed: updated.count <= limit };
  } catch (e) {
    console.warn('[rate-limit] check fallito, fail-open (richiesta consentita):', (e as Error).message);
    return { allowed: true };
  }
}

/**
 * Azzera un bucket (es. dopo un login riuscito, per non far pagare ai
 * successivi tentativi i pochi typo commessi prima). Best-effort: se la riga
 * non esiste `deleteMany` non lancia, e qualunque altro errore è ignorato —
 * non deve mai essere lui a far fallire l'azione chiamante.
 */
export async function resetRateLimit(key: string): Promise<void> {
  try {
    await prisma.rateBucket.deleteMany({ where: { key } });
  } catch (e) {
    console.warn('[rate-limit] reset fallito (ignorato):', (e as Error).message);
  }
}
