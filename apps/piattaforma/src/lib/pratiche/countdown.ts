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

/** Livello UI dell'ATTESA (giorni trascorsi): più tempo passa, più è grave. */
export type AttesaLevel = 'none' | 'ok' | 'warn' | 'urgent';

/**
 * Giorni interi trascorsi da `from` (troncati per difetto: 18 ore = 0 giorni).
 * null se `from` è null.
 */
export function giorniTrascorsi(from: Date | null, now: Date): number | null {
  if (!from) return null;
  return Math.floor((now.getTime() - from.getTime()) / MS_PER_DAY);
}

/**
 * Soglie dell'attesa di firma: ≤3g ok, 4-7g warn, >7g urgent.
 *
 * ATTENZIONE: NON è `countdownLevel`. Quella misura i giorni RESIDUI (meno =
 * peggio); questa i giorni TRASCORSI (più = peggio). Riusare l'altra qui
 * invertirebbe i colori: una pratica ferma da un mese apparirebbe verde.
 */
export function attesaLevel(giorni: number | null): AttesaLevel {
  if (giorni === null) return 'none';
  if (giorni > 7) return 'urgent';
  if (giorni > 3) return 'warn';
  return 'ok';
}
