export type FeeRow = {
  importoCent: number;
  stato: string;
  refDate: Date;
  // campi opzionali di display passati through senza essere usati nell'aggregazione
  [key: string]: unknown;
};

export type FeeMonthGroup<T extends FeeRow = FeeRow> = {
  month: string; // "YYYY-MM"
  totaleCent: number;
  rows: T[];
};

/** Chiave "YYYY-MM" da una data (UTC-stable). */
function monthKey(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

/**
 * Raggruppa le fee per mese (in base a `refDate`), ordina i mesi dal piu'
 * recente, somma `importoCent` per mese. Puro.
 */
export function groupFeeByMonth<T extends FeeRow>(rows: readonly T[]): FeeMonthGroup<T>[] {
  const map = new Map<string, FeeMonthGroup<T>>();
  for (const r of rows) {
    const key = monthKey(r.refDate);
    const g = map.get(key) ?? { month: key, totaleCent: 0, rows: [] };
    g.totaleCent += r.importoCent;
    g.rows.push(r);
    map.set(key, g);
  }
  return [...map.values()].sort((a, b) => (a.month < b.month ? 1 : -1));
}
