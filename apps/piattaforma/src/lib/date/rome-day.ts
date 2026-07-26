/**
 * Conversione giorno→istante UTC nel fuso Europe/Rome (con DST). Puro, senza IO.
 * Estratto per essere condiviso tra i filtri per range di date (feedback, addebiti).
 */

const RE_YMD = /^(\d{4})-(\d{2})-(\d{2})$/;
const ROME_TZ = 'Europe/Rome';

/** Valida che la stringa sia una data di calendario reale in formato YYYY-MM-DD. */
export function parseYmd(value: string | undefined): [number, number, number] | null {
  if (!value) return null;
  const m = RE_YMD.exec(value);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  // Round-trip: scarta le date impossibili (es. 2026-02-30 → marzo).
  const probe = new Date(Date.UTC(y, mo - 1, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== mo - 1 || probe.getUTCDate() !== d) {
    return null;
  }
  return [y, mo, d];
}

/** Offset (ms) di Europe/Rome per un dato istante UTC (positivo a est di UTC). */
function romeOffsetMs(instant: number): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: ROME_TZ,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const g: Record<string, number> = {};
  for (const p of dtf.formatToParts(new Date(instant))) {
    if (p.type !== 'literal') g[p.type] = Number(p.value);
  }
  const asUtc = Date.UTC(g.year, g.month - 1, g.day, g.hour, g.minute, g.second);
  return asUtc - instant;
}

/**
 * Istante UTC corrispondente all'ora di parete indicata nel fuso di Roma.
 *
 * Pubblica: la usa anche `lib/distribuzione/orario-piattaforma.ts` per
 * costruire gli estremi di una fascia oraria. Una seconda implementazione del
 * fuso finirebbe per divergere su DST — questa è la sola.
 */
export function romeWallClockToUtc(
  y: number,
  mo: number,
  d: number,
  h: number,
  mi: number,
  s: number,
  ms: number,
): Date {
  const naive = Date.UTC(y, mo - 1, d, h, mi, s, 0); // ms fuori dal calcolo dell'offset
  // Doppio passaggio: stabilizza il caso raro di transizione DST.
  const utc = naive - romeOffsetMs(naive - romeOffsetMs(naive));
  return new Date(utc + ms); // ms riaggiunti dopo la conversione
}

export function romeStartOfDay([y, mo, d]: [number, number, number]): Date {
  return romeWallClockToUtc(y, mo, d, 0, 0, 0, 0);
}

export function romeEndOfDay([y, mo, d]: [number, number, number]): Date {
  return romeWallClockToUtc(y, mo, d, 23, 59, 59, 999);
}

/**
 * Giorno di calendario (anno, mese 1-12, giorno) a Roma per un dato istante.
 *
 * Serve a rispondere a "che giorno è OGGI per l'azienda": alle 00:30 del 17
 * luglio a Roma in UTC sono ancora le 22:30 del 16, e usare UTC sposterebbe di
 * un giorno ogni soglia calcolata su questo (scadenza visura, preavvisi).
 */
export function romeYmd(instant: Date): [number, number, number] {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: ROME_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const g: Record<string, number> = {};
  for (const p of dtf.formatToParts(instant)) {
    if (p.type !== 'literal') g[p.type] = Number(p.value);
  }
  return [g.year!, g.month!, g.day!];
}

/**
 * Anno civile a Roma per un dato istante — non UTC. Il registro fiscale segue
 * il calendario italiano: fra le 23:00 e le 23:59 UTC del 31 dicembre a Roma
 * è già il 1° gennaio, e `instant.getUTCFullYear()`/`getFullYear()`
 * numererebbe quel documento sul registro dell'anno appena chiuso.
 */
export function romeAnnoCivile(instant: Date): number {
  return romeYmd(instant)[0];
}

/**
 * Data ISO `YYYY-MM-DD` a Roma per un dato istante — per i documenti fiscali
 * (`DataDocumento` nell'XML FatturaPA). A differenza di `instant.toISOString()`,
 * che è sempre UTC per definizione, segue il giorno di calendario italiano.
 */
export function romeIsoDate(instant: Date): string {
  const [y, mo, d] = romeYmd(instant);
  return `${String(y).padStart(4, '0')}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/**
 * Data leggibile in italiano a Roma, stile "medium" (es. "17 giu 2026") — per
 * i documenti fiscali (PDF). Stesso stile di `formatDate` in `@/lib/format`,
 * ma con `timeZone` esplicito: `formatDate` segue il fuso del runtime (UTC su
 * Vercel) ed è condivisa da 32 punti della UI, quindi resta com'è — i
 * documenti fiscali usano questa.
 */
export function romeDataLeggibile(instant: Date): string {
  return new Intl.DateTimeFormat('it-IT', { dateStyle: 'medium', timeZone: ROME_TZ }).format(instant);
}

export type DayRange = { gte?: Date; lte?: Date; da: string; a: string; active: boolean };

/**
 * Da due giorni `YYYY-MM-DD` ai bound UTC (inizio/fine giornata in Europe/Rome).
 * Bound malformato → ignorato. `da`/`a` ri-emessi solo se validi (per i default input).
 */
export function resolveDayRange(da: string | undefined, a: string | undefined): DayRange {
  const daYmd = parseYmd(da);
  const aYmd = parseYmd(a);
  return {
    gte: daYmd ? romeStartOfDay(daYmd) : undefined,
    lte: aYmd ? romeEndOfDay(aYmd) : undefined,
    da: daYmd ? da! : '',
    a: aYmd ? a! : '',
    active: Boolean(daYmd || aYmd),
  };
}
