/**
 * Gate "calendario piattaforma" per l'espansione della distribuzione a raggio.
 *
 * Puro, senza accessi DB: riceve `now` e il calendario già risolto.
 *
 * Tre livelli, in quest'ordine: il giorno è attivo? la data non è un festivo?
 * l'ora cade nella fascia di quel giorno? Basta un no per fermare l'espansione.
 *
 * Fuso: le fasce sono ore di parete italiane, ma su Vercel il processo gira in
 * UTC, quindi nulla qui usa `now.getHours()/getDay()`. Da `lib/date/rome-day.ts`
 * arrivano solo `romeYmd` (la data di calendario a Roma, da cui si ricavano
 * giorno della settimana e chiave dei festivi) e `romeWallClockToUtc`; i minuti
 * dalla mezzanotte li calcola `minutiDelGiornoRoma`, locale a questo file.
 */

import { romeYmd, romeWallClockToUtc } from '@/lib/date/rome-day';
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

/**
 * Guardia anti-loop: oltre un anno di scansione l'input è patologico (o il
 * calendario è tutto spento, e allora non c'è nulla da sommare). Senza, un
 * `da` molto vecchio con calendario chiuso itererebbe indefinitamente.
 */
const MAX_GIORNI_SCANSIONE = 400;

/** Millisecondi in un minuto, per non ripetere il numero magico. */
const MS_PER_MIN = 60_000;

/**
 * Minuti di ORARIO LAVORATIVO fra `da` e `a`, secondo il calendario: i minuti
 * fuori finestra, nei giorni spenti e nei festivi valgono zero.
 *
 * È il metro con cui si misura la durata di un round. Serve a garantire che
 * ogni cerchio di agenzie abbia la sua finestra piena per rispondere: con una
 * semplice sottrazione, una pratica inviata di notte vedrebbe partire il round
 * successivo nell'istante stesso dell'apertura.
 *
 * `cap` è la soglia che interessa al chiamante: appena il totale la raggiunge
 * la scansione si ferma. Senza, una pratica ferma da settimane costerebbe una
 * iterazione per giorno a ogni tick, per ogni pratica.
 *
 * Pura: nessun DB, nessun `Date.now()` — solo i due istanti ricevuti.
 */
export function minutiLavorativiTra(
  da: Date,
  a: Date,
  cal: CalendarioPiattaforma,
  cap: number,
): number {
  if (!(a.getTime() > da.getTime())) return 0;

  const festivi = new Set(cal.festivi.map((f) => f.data));
  let totale = 0;
  let ymd = romeYmd(da);

  for (let i = 0; i < MAX_GIORNI_SCANSIONE; i += 1) {
    const chiave = ymdKey(ymd);
    const fascia = cal.orariSettimana[giornoSettimanaDa(ymd)];

    if (fascia.attivo && !festivi.has(chiave)) {
      const [y, mo, d] = ymd;
      const [hi, mi] = fascia.inizio.split(':').map(Number) as [number, number];
      const [hf, mf] = fascia.fine.split(':').map(Number) as [number, number];
      const apertura = romeWallClockToUtc(y, mo, d, hi, mi, 0, 0).getTime();
      const chiusura = romeWallClockToUtc(y, mo, d, hf, mf, 0, 0).getTime();

      const inizio = Math.max(da.getTime(), apertura);
      const fine = Math.min(a.getTime(), chiusura);
      if (fine > inizio) totale += (fine - inizio) / MS_PER_MIN;

      if (totale >= cap) return totale;
    }

    // Giorno successivo: si passa da mezzogiorno, l'unica ora di parete che il
    // DST non sposta mai fuori dal proprio giorno.
    const mezzogiorno = romeWallClockToUtc(ymd[0], ymd[1], ymd[2], 12, 0, 0, 0);
    const domani = new Date(mezzogiorno.getTime() + 24 * 60 * MS_PER_MIN);
    if (domani.getTime() > a.getTime() + 24 * 60 * MS_PER_MIN) break;
    ymd = romeYmd(domani);
  }

  return totale;
}
