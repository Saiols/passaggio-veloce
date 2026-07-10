import type { Permesso } from '@/lib/auth/permessi/catalogo';

export type NavCtx = { isOwner: boolean; permessi: readonly Permesso[] };

/** Voce senza `permesso`: visibile a tutti (Dashboard, Profilo). */
export function vede(ctx: NavCtx, p?: Permesso): boolean {
  if (p === undefined) return true;
  return ctx.isOwner || ctx.permessi.includes(p);
}

/**
 * Scarta le voci negate, poi i gruppi rimasti vuoti. Non muta l'input.
 *
 * Se i gruppi hanno voci eterogenee (alcune senza `permesso`, altre con
 * `permesso` diversi tra un gruppo e l'altro — il caso normale di una
 * sidebar), passa `T` esplicitamente: `filtraGruppi<MioNavItem>([...], ctx)`.
 * Senza, `tsc` non riesce a inferire un `T` unico su tutto l'argomento e va in
 * errore (limite di inferenza, non un bug della funzione).
 */
export function filtraGruppi<T extends { permesso?: Permesso }>(
  gruppi: { label: string; items: T[] }[],
  ctx: NavCtx,
): { label: string; items: T[] }[] {
  return gruppi
    .map((g) => ({ ...g, items: g.items.filter((i) => vede(ctx, i.permesso)) }))
    .filter((g) => g.items.length > 0);
}
