/**
 * Gate "orario lavorativo piattaforma" per l'espansione della distribuzione a raggio.
 *
 * Puro, senza accessi DB — riceve `now` e la config già risolta (`DistribuzioneConfigDTO`,
 * v. `./config.ts`).
 *
 * Fuso orario: la finestra (`orarioInizio`/`orarioFine`, es. 09:00-19:00) è pensata in ora
 * locale italiana (Europe/Rome), ma su Vercel il server gira in UTC. Il giorno-settimana e
 * i minuti-dal-mezzanotte di `now` vengono quindi calcolati nel fuso Europe/Rome (stessa
 * tecnica di `lib/date/rome-day.ts`: `Intl.DateTimeFormat` con `timeZone: 'Europe/Rome'`),
 * NON con `now.getHours()/getDay()` diretti (quelli userebbero il fuso del processo).
 */

import type { GiornoSettimana } from './ore-lavorative';
import type { DistribuzioneConfigDTO } from './config';

const ROME_TZ = 'Europe/Rome';

/** Stesso ordine/mapping (privato) usato in `ore-lavorative.ts`: getDay()-style, domenica=0. */
const GIORNI_ORDER: GiornoSettimana[] = ['DOM', 'LUN', 'MAR', 'MER', 'GIO', 'VEN', 'SAB'];

function parseHHMMToMinuti(s: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s);
  if (!m) throw new Error(`Orario malformato: ${s}`);
  const h = Number(m[1]!);
  const mm = Number(m[2]!);
  if (h < 0 || h > 23 || mm < 0 || mm > 59) {
    throw new Error(`Orario fuori range: ${s}`);
  }
  return h * 60 + mm;
}

/** Giorno-settimana + minuti-dalla-mezzanotte di `instant`, nel fuso Europe/Rome. */
function romeGiornoEMinuti(instant: Date): { giorno: GiornoSettimana; minuti: number } {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: ROME_TZ,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
  const g: Record<string, number> = {};
  for (const p of dtf.formatToParts(instant)) {
    if (p.type !== 'literal') g[p.type] = Number(p.value);
  }
  // Il giorno della settimana dipende solo dalla data di calendario (già risolta nel fuso
  // di Roma sopra), non dall'ora: Date.UTC qui è solo un modo neutro per ricavare il
  // weekday da (anno, mese, giorno) senza reintrodurre il fuso della macchina locale.
  const giorno = GIORNI_ORDER[new Date(Date.UTC(g.year!, g.month! - 1, g.day!)).getUTCDay()]!;
  const minuti = g.hour! * 60 + g.minute!;
  return { giorno, minuti };
}

/**
 * True se `now` (in ora di Roma) cade in un giorno di `cfg.giorni` E nella finestra
 * `[orarioInizio, orarioFine)` — l'estremo di fine è ESCLUSO (es. 19:00 → false).
 */
export function isOrarioLavorativo(now: Date, cfg: DistribuzioneConfigDTO): boolean {
  const { giorno, minuti } = romeGiornoEMinuti(now);
  if (!cfg.giorni.includes(giorno)) return false;

  const inizio = parseHHMMToMinuti(cfg.orarioInizio);
  const fine = parseHHMMToMinuti(cfg.orarioFine);
  return minuti >= inizio && minuti < fine;
}
