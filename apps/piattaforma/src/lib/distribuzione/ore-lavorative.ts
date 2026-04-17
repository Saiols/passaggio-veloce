/**
 * Engine "ore lavorative" per agenzia.
 *
 * Pure, senza accessi DB — accetta dati pre-letti in input (fasce orarie + chiusure).
 *
 * Concetti:
 * - Il countdown per una assegnazione scorre SOLO durante le fasce di apertura
 *   dichiarate dall'agenzia, ignorando notti/weekend e chiusure straordinarie.
 * - `firstOpeningAt(from)` → primo istante utile dal momento `from` (se già
 *   dentro una fascia, ritorna `from` invariato).
 * - `addBusinessHours(startAt, hours)` → istante in cui si sono consumate
 *   `hours` ore lavorative a partire da `startAt`.
 */

export type GiornoSettimana = 'LUN' | 'MAR' | 'MER' | 'GIO' | 'VEN' | 'SAB' | 'DOM';

export type Fascia = { inizio: string; fine: string }; // "HH:MM"

export type FasceByGiorno = Partial<Record<GiornoSettimana, Fascia[]>>;

export type Chiusura = { dataInizio: Date; dataFine: Date };

/**
 * Safety cap: se dopo 120 giorni di ricerca non si trova una fascia,
 * significa che l'agenzia è de-facto chiusa. Meglio errore esplicito che loop.
 */
const MAX_SEARCH_DAYS = 120;

const GIORNI_ORDER: GiornoSettimana[] = ['DOM', 'LUN', 'MAR', 'MER', 'GIO', 'VEN', 'SAB'];

function giornoDiSettimana(date: Date): GiornoSettimana {
  // getDay(): domenica=0, lunedì=1, ...
  return GIORNI_ORDER[date.getDay()]!;
}

function parseHHMM(s: string): { h: number; m: number } {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s);
  if (!m) throw new Error(`Fascia oraria malformata: ${s}`);
  const h = Number(m[1]!);
  const mm = Number(m[2]!);
  if (h < 0 || h > 23 || mm < 0 || mm > 59) {
    throw new Error(`Fascia oraria fuori range: ${s}`);
  }
  return { h, m: mm };
}

function combineDateTime(date: Date, hhmm: string): Date {
  const { h, m } = parseHHMM(hhmm);
  const d = new Date(date);
  d.setHours(h, m, 0, 0);
  return d;
}

function startOfDay(d: Date): Date {
  const r = new Date(d);
  r.setHours(0, 0, 0, 0);
  return r;
}

function nextDay(d: Date): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + 1);
  r.setHours(0, 0, 0, 0);
  return r;
}

function isChiuso(date: Date, chiusure: readonly Chiusura[]): boolean {
  const day = startOfDay(date).getTime();
  return chiusure.some((c) => {
    const from = startOfDay(c.dataInizio).getTime();
    const to = startOfDay(c.dataFine).getTime();
    return day >= from && day <= to;
  });
}

function sortFasce(fasce: Fascia[]): Fascia[] {
  return [...fasce].sort((a, b) => a.inizio.localeCompare(b.inizio));
}

/**
 * Ritorna il primo istante utile dopo `from` in cui l'agenzia è aperta.
 * Se `from` cade dentro una fascia, ritorna `from` stesso.
 */
export function firstOpeningAt(
  from: Date,
  fasce: FasceByGiorno,
  chiusure: readonly Chiusura[] = [],
): Date {
  let cursor = new Date(from);
  for (let i = 0; i < MAX_SEARCH_DAYS; i += 1) {
    if (!isChiuso(cursor, chiusure)) {
      const giorno = giornoDiSettimana(cursor);
      const fasceDelGiorno = sortFasce(fasce[giorno] ?? []);
      for (const f of fasceDelGiorno) {
        const fInizio = combineDateTime(cursor, f.inizio);
        const fFine = combineDateTime(cursor, f.fine);
        if (cursor < fInizio) return fInizio;
        if (cursor < fFine) return cursor;
      }
    }
    cursor = nextDay(cursor);
  }
  throw new Error('Nessuna fascia utile trovata nei prossimi 120 giorni');
}

/**
 * Ritorna il datetime in cui `hoursToAdd` ore lavorative si saranno consumate
 * partendo da `startAt`. Supporta frazioni (es. 8.5 ore).
 */
export function addBusinessHours(
  startAt: Date,
  hoursToAdd: number,
  fasce: FasceByGiorno,
  chiusure: readonly Chiusura[] = [],
): Date {
  if (hoursToAdd <= 0) return startAt;

  let cursor = firstOpeningAt(startAt, fasce, chiusure);
  let remainingMs = hoursToAdd * 3_600_000;

  for (let i = 0; i < MAX_SEARCH_DAYS * 4; i += 1) {
    if (!isChiuso(cursor, chiusure)) {
      const giorno = giornoDiSettimana(cursor);
      const fasceDelGiorno = sortFasce(fasce[giorno] ?? []);
      for (const f of fasceDelGiorno) {
        const fInizio = combineDateTime(cursor, f.inizio);
        const fFine = combineDateTime(cursor, f.fine);
        // Cursor arrivato dopo la fine fascia: salto
        if (cursor >= fFine) continue;
        // Cursor prima dell'inizio fascia (es. sto attraversando la pausa pranzo):
        // allinea il cursor all'inizio fascia prima di consumare ore.
        const effectiveStart = cursor < fInizio ? fInizio : cursor;
        const disponibileMs = fFine.getTime() - effectiveStart.getTime();
        if (remainingMs <= disponibileMs) {
          return new Date(effectiveStart.getTime() + remainingMs);
        }
        remainingMs -= disponibileMs;
        cursor = fFine; // esaurita la fascia, il prossimo iter riparte da qui
      }
    }
    // Prossima apertura dopo la fine della giornata
    cursor = firstOpeningAt(nextDay(cursor), fasce, chiusure);
  }

  throw new Error('Superato limite iterazioni in addBusinessHours');
}

/**
 * Helper: converte un valore JSON libero (dal campo `OrariApertura.fasceOrarie`)
 * in array di fasce validato. Ritorna [] se malformato.
 */
export function parseFasceOrarie(raw: unknown): Fascia[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (f): f is Fascia =>
      typeof f === 'object' &&
      f !== null &&
      typeof (f as Fascia).inizio === 'string' &&
      typeof (f as Fascia).fine === 'string',
  );
}
