/**
 * Gate "calendario piattaforma" per l'espansione della distribuzione a raggio.
 *
 * Puro, senza accessi DB: riceve `now` e il calendario già risolto.
 *
 * Tre livelli, in quest'ordine: il giorno è attivo? la data non è un festivo?
 * l'ora cade nella fascia di quel giorno? Basta un no per fermare l'espansione.
 *
 * Fuso: le fasce sono ore di parete italiane, ma su Vercel il processo gira in
 * UTC. Giorno e minuti si calcolano quindi in `Europe/Rome` tramite
 * `lib/date/rome-day.ts`, mai con `now.getHours()/getDay()`.
 */

import { romeYmd } from '@/lib/date/rome-day';
import type { GiornoSettimana } from './ore-lavorative';
import { hhmmToMinuti, type CalendarioPiattaforma } from './calendario';

/** Mapping in ordine `getUTCDay()`: domenica = 0. */
const GIORNI_GETDAY: readonly GiornoSettimana[] = [
  'DOM', 'LUN', 'MAR', 'MER', 'GIO', 'VEN', 'SAB',
];

/** Giorno della settimana di una data di calendario (già risolta a Roma). */
export function giornoSettimanaDa([y, mo, d]: [number, number, number]): GiornoSettimana {
  // Date.UTC qui è solo un modo neutro di ricavare il weekday da (y, mo, d):
  // il fuso è già stato applicato a monte da romeYmd.
  return GIORNI_GETDAY[new Date(Date.UTC(y, mo - 1, d)).getUTCDay()]!;
}

/** Chiave `YYYY-MM-DD` di una data di calendario, per il confronto coi festivi. */
export function ymdKey([y, mo, d]: [number, number, number]): string {
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/**
 * True se `now` (in ora di Roma) cade in un giorno attivo, non festivo, e
 * dentro `[inizio, fine)` — l'estremo di fine è ESCLUSO (19:00 → false).
 */
export function isOrarioLavorativo(now: Date, cal: CalendarioPiattaforma): boolean {
  const ymd = romeYmd(now);
  const fascia = cal.orariSettimana[giornoSettimanaDa(ymd)];
  if (!fascia.attivo) return false;
  if (cal.festivi.some((f) => f.data === ymdKey(ymd))) return false;

  const minuti = minutiDelGiornoRoma(now);
  return minuti >= hhmmToMinuti(fascia.inizio) && minuti < hhmmToMinuti(fascia.fine);
}

/** Minuti dalla mezzanotte di `instant`, letti nel fuso di Roma. */
function minutiDelGiornoRoma(instant: Date): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Rome',
    hourCycle: 'h23',
    hour: '2-digit',
    minute: '2-digit',
  });
  const g: Record<string, number> = {};
  for (const p of dtf.formatToParts(instant)) {
    if (p.type !== 'literal') g[p.type] = Number(p.value);
  }
  return g.hour! * 60 + g.minute!;
}
