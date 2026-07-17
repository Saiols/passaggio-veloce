import { romeYmd } from '@/lib/date/rome-day';

/**
 * Giorni di CALENDARIO (fuso Europe/Rome) trascorsi da `from` a `now`. Conta i
 * confini di mezzanotte a Roma, non i periodi di 24h: una pratica accettata ieri
 * sera è "1 giorno" anche se sono passate 14 ore. 0 lo stesso giorno; null se
 * `from` è null.
 */
export function giorniCalendarioTrascorsi(from: Date | null, now: Date): number | null {
  if (!from) return null;
  const [y1, m1, d1] = romeYmd(from);
  const [y2, m2, d2] = romeYmd(now);
  const a = Date.UTC(y1, m1 - 1, d1);
  const b = Date.UTC(y2, m2 - 1, d2);
  return Math.max(0, Math.round((b - a) / 86_400_000));
}

export type FermaLevel = 'ok' | 'warn' | 'urgent';

/** Rosso a partire da 3 giorni (spec); ambra come pre-avviso soft a 2. */
export const FERMA_SOGLIA_ROSSO = 3;
export const FERMA_SOGLIA_AMBRA = 2;

export function fermaLevel(giorni: number | null): FermaLevel {
  if (giorni === null) return 'ok';
  if (giorni >= FERMA_SOGLIA_ROSSO) return 'urgent';
  if (giorni >= FERMA_SOGLIA_AMBRA) return 'warn';
  return 'ok';
}
