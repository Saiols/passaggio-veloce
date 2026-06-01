const MS_PER_DAY = 24 * 60 * 60 * 1000;

export type CountdownLevel = 'none' | 'ok' | 'warn' | 'urgent' | 'overdue';

/**
 * Giorni interi residui fino a `target` (arrotondati per eccesso).
 * Negativo se la data e' passata; null se `target` e' null.
 */
export function computeGiorniResidui(target: Date | null, now: Date): number | null {
  if (!target) return null;
  return Math.ceil((target.getTime() - now.getTime()) / MS_PER_DAY);
}

/** Livello UI in base ai giorni residui. */
export function countdownLevel(giorni: number | null): CountdownLevel {
  if (giorni === null) return 'none';
  if (giorni < 0) return 'overdue';
  if (giorni <= 2) return 'urgent';
  if (giorni <= 5) return 'warn';
  return 'ok';
}
