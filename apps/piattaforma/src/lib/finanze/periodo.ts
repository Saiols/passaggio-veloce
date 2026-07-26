/**
 * Periodo delle metriche finanziarie: fonte unica per la pagina Finanze
 * (`/admin/dashboard`) e per l'export CSV.
 *
 * Le due copie precedenti erano già divergenti: la route di export non
 * conosceva il valore `giorno`, che finiva nel ramo `else` di `anno`, e dal
 * tab "Ultime 24h" il CSV scaricava un anno intero senza dirlo. Chi aggiunge
 * un periodo tocca questo file e basta.
 *
 * Puro, niente IO: `now` è iniettabile per i test.
 */
import type { Prisma } from '@pv/db';
import { resolveDayRange, romeYmd } from '@/lib/date/rome-day';

export const PERIODI = ['giorno', 'settimana', 'mese', 'anno', 'custom'] as const;
export type Periodo = (typeof PERIODI)[number];

export const TIPI_FILTRO = ['SEMPLICE', 'MINIVOLTURA'] as const;
/** `''` = nessun filtro tipo. È il valore di default, non un caso limite. */
export type TipoFiltro = '' | (typeof TIPI_FILTRO)[number];

export type PeriodoRisolto = {
  /** Estremo inferiore; assente = aperto a sinistra (solo su `custom`). */
  gte?: Date;
  /** Estremo superiore; le finestre mobili non ne hanno mai uno. */
  lte?: Date;
  /** Testo per l'intestazione: "Ultimo mese" o "Dal 01/06/2026 al 30/06/2026". */
  label: string;
  /** `YYYY-MM-DD` ri-emessi solo se validi, per i `defaultValue` degli input. */
  da: string;
  a: string;
};

const LABEL_MOBILE = {
  giorno: 'Ultime 24h',
  settimana: 'Ultima settimana',
  mese: 'Ultimo mese',
  anno: 'Ultimo anno',
} as const;

/** Valore assente o sconosciuto → `mese`, il default storico della pagina. */
export function parsePeriodo(value: string | undefined | null): Periodo {
  return (PERIODI as readonly string[]).includes(value ?? '') ? (value as Periodo) : 'mese';
}

/**
 * Valore assente o sconosciuto → `''` (nessun filtro tipo), mai un valore che
 * Prisma rifiuta. Letto grezzo dalla query string sia dalla pagina sia
 * dall'export: entrambi lo passano da qui prima di usarlo, che sia per il
 * `where` o per il nome del file scaricato.
 */
export function parseTipo(value: string | undefined | null): TipoFiltro {
  return (TIPI_FILTRO as readonly string[]).includes(value ?? '') ? (value as TipoFiltro) : '';
}

export function periodoLabel(p: Periodo): string {
  return p === 'custom' ? 'Personalizzato' : LABEL_MOBILE[p];
}

/** `YYYY-MM-DD` → `DD/MM/YYYY`. La stringa arriva già validata da parseYmd. */
function itDate(ymd: string): string {
  const [y, mo, d] = ymd.split('-');
  return `${d}/${mo}/${y}`;
}

function labelCustom(da: string, a: string): string {
  if (da && a) return `Dal ${itDate(da)} al ${itDate(a)}`;
  if (da) return `Dal ${itDate(da)}`;
  if (a) return `Fino al ${itDate(a)}`;
  return 'Tutto lo storico';
}

/**
 * Finestra mobile: identica al calcolo che viveva in `page.tsx`, setter locali
 * compresi. Cambiarla sposterebbe metriche già in produzione.
 */
function inizioFinestraMobile(p: Exclude<Periodo, 'custom'>, now: Date): Date {
  const d = new Date(now.getTime());
  if (p === 'giorno') d.setDate(d.getDate() - 1);
  else if (p === 'settimana') d.setDate(d.getDate() - 7);
  else if (p === 'mese') d.setMonth(d.getMonth() - 1);
  else d.setFullYear(d.getFullYear() - 1);
  return d;
}

export function resolvePeriodo(args: {
  periodo: Periodo;
  da?: string;
  a?: string;
  now?: Date;
}): PeriodoRisolto {
  if (args.periodo === 'custom') {
    // Giorni interi in Europe/Rome: DST e date impossibili sono già gestiti lì.
    const r = resolveDayRange(args.da, args.a);
    return { gte: r.gte, lte: r.lte, label: labelCustom(r.da, r.a), da: r.da, a: r.a };
  }
  return {
    gte: inizioFinestraMobile(args.periodo, args.now ?? new Date()),
    label: periodoLabel(args.periodo),
    da: '',
    a: '',
  };
}

function ymdString(y: number, mo: number, d: number): string {
  return `${String(y).padStart(4, '0')}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** Ultimo giorno del mese `mo` (1-12) dell'anno `y`. */
function giorniNelMese(y: number, mo: number): number {
  return new Date(Date.UTC(y, mo, 0)).getUTCDate();
}

/**
 * Range con cui nasce il tab personalizzato: ultimo mese in giorni di
 * calendario romani. Il giorno viene da `romeYmd` e non da `getDate()` perché
 * il runtime su Vercel è UTC e fino all'una di notte italiana sbaglierebbe
 * data. La sottrazione clampa al fondo del mese: dal 31 marzo si torna al 28
 * febbraio, non al 3 marzo come farebbe `setMonth` da solo.
 */
export function defaultCustomRange(now: Date): { da: string; a: string } {
  const [y, mo, d] = romeYmd(now);
  const annoPrec = mo === 1 ? y - 1 : y;
  const mesePrec = mo === 1 ? 12 : mo - 1;
  return {
    da: ymdString(annoPrec, mesePrec, Math.min(d, giorniNelMese(annoPrec, mesePrec))),
    a: ymdString(y, mo, d),
  };
}

/**
 * Bound del periodo come filtro Prisma su un campo data. `undefined` quando il
 * range è aperto da entrambi i lati: un `{}` passato a Prisma sarebbe un
 * filtro inerte, ma renderebbe impossibile distinguere "nessun filtro" dal
 * lato del chiamante.
 */
export function periodoDateFilter(r: PeriodoRisolto): { gte?: Date; lte?: Date } | undefined {
  if (!r.gte && !r.lte) return undefined;
  return { ...(r.gte ? { gte: r.gte } : {}), ...(r.lte ? { lte: r.lte } : {}) };
}

/**
 * Da query string ai filtri delle metriche Finanze: un solo punto in cui la
 * pagina e l'export possono divergere, ed è questo. Prima di questa funzione
 * i due consumer ricostruivano `where` a mano — `tipo` incluso, validato per
 * il filtro ma non per il nome del file scaricato nell'export: da lì un
 * `tipo` qualsiasi finiva nel filename e nell'header
 * `Content-Disposition`. Chi chiama `filtriPratiche` non vede mai un `tipo`
 * diverso da `''`, `'SEMPLICE'` o `'MINIVOLTURA'`, in nessun campo del
 * risultato.
 */
export function filtriPratiche(params: {
  periodo?: string | null;
  tipo?: string | null;
  da?: string | null;
  a?: string | null;
  now?: Date;
}): {
  periodo: Periodo;
  tipo: TipoFiltro;
  range: PeriodoRisolto;
  where: Prisma.PraticaWhereInput;
} {
  const periodo = parsePeriodo(params.periodo);
  const tipo = parseTipo(params.tipo);
  const range = resolvePeriodo({
    periodo,
    da: params.da ?? undefined,
    a: params.a ?? undefined,
    now: params.now,
  });
  const dateFilter = periodoDateFilter(range);
  const where: Prisma.PraticaWhereInput = { deletedAt: null };
  if (dateFilter) where.createdAt = dateFilter;
  if (tipo) where.tipo = tipo;
  return { periodo, tipo, range, where };
}
