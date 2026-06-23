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
