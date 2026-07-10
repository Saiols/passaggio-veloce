import type { Prisma } from '@pv/db';
import { whereValutazione, type SedeScope } from '@/lib/sedi/scope-filters';
import { resolveDayRange } from '@/lib/date/rome-day';

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
  const range = resolveDayRange(params.da, params.a);
  const createdAt: { gte?: Date; lte?: Date } = {};
  if (range.gte) createdAt.gte = range.gte;
  if (range.lte) createdAt.lte = range.lte;
  if (range.gte || range.lte) where.createdAt = createdAt;

  return { where, sede, da: range.da, a: range.a, attivi: Boolean(sede) || range.active };
}
