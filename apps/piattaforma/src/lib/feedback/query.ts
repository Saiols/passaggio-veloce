import type { Prisma } from '@pv/db';
import { whereValutazione, type SedeScope } from '@/lib/sedi/scope-filters';

export type FeedbackFilterParams = { da?: string; a?: string; sede?: string };

export type ResolvedFeedbackFilters = {
  /** Where per findMany E aggregate (stesso insieme → media/conteggio coerenti). */
  where: Prisma.ValutazioneWhereInput;
  /** Sede selezionata validata (solo owner); '' = tutte → default del select. */
  sede: string;
  /** Bound date validi ri-emessi per i default degli input (o ''). */
  da: string;
  a: string;
  /** Almeno un filtro attivo (per testo header / empty-state). */
  attivi: boolean;
};

const RE_YMD = /^(\d{4})-(\d{2})-(\d{2})$/;
const ROME_TZ = 'Europe/Rome';

/** Valida che la stringa sia una data di calendario reale in formato YYYY-MM-DD. */
function parseYmd(value: string | undefined): [number, number, number] | null {
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

/** Istante UTC corrispondente all'ora di parete indicata nel fuso di Roma. */
function romeWallClockToUtc(
  y: number,
  mo: number,
  d: number,
  h: number,
  mi: number,
  s: number,
  ms: number,
): Date {
  const naive = Date.UTC(y, mo - 1, d, h, mi, s, 0); // No milliseconds for offset calc
  // Doppio passaggio: stabilizza il caso raro di transizione DST.
  const utc = naive - romeOffsetMs(naive - romeOffsetMs(naive));
  return new Date(utc + ms); // Add milliseconds after offset calculation
}

function romeStartOfDay([y, mo, d]: [number, number, number]): Date {
  return romeWallClockToUtc(y, mo, d, 0, 0, 0, 0);
}

function romeEndOfDay([y, mo, d]: [number, number, number]): Date {
  return romeWallClockToUtc(y, mo, d, 23, 59, 59, 999);
}

/**
 * Compone il `where` dei feedback per la pagina `/feedback`.
 *
 * Owner: base SEMPRE aggregata (tutte le sedi), il select in pagina è l'unico
 * controllo sede → ignora il cookie globale `pv_sede`. Non-owner: scope invariato
 * per sede. Il range date vale per tutti; i giorni sono interpretati in Europe/Rome.
 */
export function resolveFeedbackFilters(args: {
  isOwner: boolean;
  agenziaId: string;
  scopeIds: string[];
  accessibleSedeIds: string[];
  params: FeedbackFilterParams;
}): ResolvedFeedbackFilters {
  const { isOwner, agenziaId, scopeIds, accessibleSedeIds, params } = args;

  // Base per sede. Owner → aggregate=true ⇒ { agenziaId } (tutte le sedi).
  const scope: SedeScope = { scopeIds, aggregate: isOwner, isOwner };
  const where: Prisma.ValutazioneWhereInput = whereValutazione(scope, agenziaId);

  // Narrowing sede: solo owner, solo se la sede è tra quelle accessibili.
  let sede = '';
  if (isOwner && params.sede && accessibleSedeIds.includes(params.sede)) {
    sede = params.sede;
    where.agenziaSedeId = sede;
  }

  // Range date (tutti). Bound malformato → ignorato.
  const daYmd = parseYmd(params.da);
  const aYmd = parseYmd(params.a);
  const createdAt: { gte?: Date; lte?: Date } = {};
  if (daYmd) createdAt.gte = romeStartOfDay(daYmd);
  if (aYmd) createdAt.lte = romeEndOfDay(aYmd);
  if (createdAt.gte || createdAt.lte) where.createdAt = createdAt;

  return {
    where,
    sede,
    da: daYmd ? params.da! : '',
    a: aYmd ? params.a! : '',
    attivi: Boolean(sede || daYmd || aYmd),
  };
}
