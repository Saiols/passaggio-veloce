/**
 * Scoping multi-sede — logica pura (niente IO).
 *
 * Determina quali sedi un utente può vedere/operare e qual è la "sede corrente"
 * del contesto operativo, a partire da ruolo, membership e cookie `pv_sede`.
 * L'orchestrazione (auth + DB + cookie) vive in lib/auth/session-context.ts.
 */

export type SedeType = 'DEALER' | 'AGENZIA';

export type SedeRef = {
  id: string;
  nome: string;
  type: SedeType;
};

/** Valore speciale del cookie `pv_sede` per la vista aggregata del proprietario. */
export const SEDE_ALL = 'ALL';

export type CurrentSede = { kind: 'ALL' } | { kind: 'ONE'; sede: SedeRef };

/**
 * Sedi accessibili: il proprietario (madre) accede a tutte le sedi della madre;
 * gli altri solo a quelle in cui hanno una membership.
 */
export function resolveAccessibleSedi(args: {
  isOwner: boolean;
  companySedi: SedeRef[];
  membershipSedeIds: string[];
}): SedeRef[] {
  if (args.isOwner) return args.companySedi;
  const allowed = new Set(args.membershipSedeIds);
  return args.companySedi.filter((s) => allowed.has(s.id));
}

/**
 * Sede corrente del contesto operativo.
 * - cookie = id di una sede accessibile → quella sede;
 * - proprietario senza cookie valido (o cookie 'ALL') → vista aggregata ALL;
 * - non-proprietario senza cookie valido → la prima sede accessibile (deterministico);
 * - non-proprietario senza sedi accessibili → null.
 */
export function resolveCurrentSede(args: {
  isOwner: boolean;
  accessibleSedi: SedeRef[];
  cookieValue: string | null;
}): CurrentSede | null {
  const { isOwner, accessibleSedi, cookieValue } = args;

  if (cookieValue && cookieValue !== SEDE_ALL) {
    const match = accessibleSedi.find((s) => s.id === cookieValue);
    if (match) return { kind: 'ONE', sede: match };
  }

  if (isOwner) return { kind: 'ALL' };

  if (accessibleSedi.length === 0) return null;
  return { kind: 'ONE', sede: accessibleSedi[0] };
}

/** True se `sedeId` è tra le sedi accessibili. */
export function assertSedeAccess(sedeId: string, accessibleSedi: SedeRef[]): boolean {
  return accessibleSedi.some((s) => s.id === sedeId);
}

/**
 * Lista di sedeId su cui filtrare le query operative, dato il contesto:
 * - sede corrente ONE → solo quella sede;
 * - vista aggregata ALL (proprietario) → tutte le sedi accessibili;
 * - nessuna sede → lista vuota (il chiamante decide il fallback).
 * Le query usano `{ in: ids }` in modo uniforme.
 */
export function sedeScopeIds(args: {
  currentSede: CurrentSede | null;
  accessibleSedi: SedeRef[];
}): string[] {
  if (!args.currentSede) return [];
  if (args.currentSede.kind === 'ONE') return [args.currentSede.sede.id];
  return args.accessibleSedi.map((s) => s.id);
}

/**
 * Sede in cui l'utente sta operando per una SCRITTURA (es. creare una pratica).
 * - sede corrente ONE → quella sede;
 * - vista ALL ma con una sola sede accessibile (caso 1:1) → quella sede;
 * - vista ALL con più sedi → null (l'utente deve prima selezionare una sede);
 * - nessuna sede → null.
 */
export function resolveOperatingSede(args: {
  currentSede: CurrentSede | null;
  accessibleSedi: SedeRef[];
}): SedeRef | null {
  if (args.currentSede?.kind === 'ONE') return args.currentSede.sede;
  if (args.currentSede?.kind === 'ALL' && args.accessibleSedi.length === 1) {
    return args.accessibleSedi[0];
  }
  return null;
}

/**
 * Sede broker da usare per una SCRITTURA quando il client può inviare
 * esplicitamente l'id sede scelto (es. selettore "Sede di partenza" nel wizard
 * pratica). Se l'id è presente dev'essere tra le sedi accessibili (no fallback
 * silenzioso, è un controllo di accesso); se assente si ricade sulla sede
 * operativa del contesto (ONE, oppure ALL con una sola sede).
 */
export function resolveSubmittedSede(args: {
  submittedId: string | null | undefined;
  currentSede: CurrentSede | null;
  accessibleSedi: SedeRef[];
}): SedeRef | null {
  const { submittedId, currentSede, accessibleSedi } = args;
  if (submittedId) {
    return accessibleSedi.find((s) => s.id === submittedId) ?? null;
  }
  return resolveOperatingSede({ currentSede, accessibleSedi });
}

/**
 * True se l'utente può selezionare `target` come sede corrente.
 * `target` = 'ALL' è permesso solo al proprietario; altrimenti dev'essere
 * una sede accessibile.
 */
export function canSelectSede(
  target: string,
  ctx: { isOwner: boolean; accessibleSedi: SedeRef[] },
): boolean {
  if (target === SEDE_ALL) return ctx.isOwner;
  return assertSedeAccess(target, ctx.accessibleSedi);
}
