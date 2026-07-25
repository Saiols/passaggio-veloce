import { can, type CanCtx } from '@/lib/auth/permessi/check';
import type { Permesso } from '@/lib/auth/permessi/catalogo';

/**
 * Contesto della nav. `permessi` è un ARRAY, non un Set, perché attraversa il
 * boundary server→client (un Set non è serializzabile nel payload RSC).
 *
 * `soloLettura` è OBBLIGATORIO: `vede()` era un `can()` riscritto a mano
 * (`ctx.isOwner || ctx.permessi.includes(p)`), strutturalmente parallelo a
 * `PermessiCtx` ma non lui — quindi la garanzia che il compilatore dà su
 * `soloLettura` non lo raggiungeva. Oggi l'effetto sarebbe nullo (tutte le voci
 * di nav sono gated su chiavi di lettura), ma una voce futura gated su una
 * chiave di SCRITTURA resterebbe visibile a un titolare sospeso: è la stessa
 * forma del bug già trovato una volta in questo branch (l'adattatore locale del
 * modulo team). Con il campo obbligatorio, ogni sito di costruzione è enumerato
 * dal compilatore.
 */
export type NavCtx = { isOwner: boolean; permessi: readonly Permesso[]; soloLettura: boolean };

/**
 * L'unico adattamento NavCtx → CanCtx. Il Set si costruisce qui: la nav ha una
 * ventina di voci e il catalogo trenta chiavi, quindi il costo è irrilevante e
 * non giustifica una seconda copia della regola.
 */
function toCanCtx(ctx: NavCtx): CanCtx {
  return { isOwner: ctx.isOwner, permessi: new Set(ctx.permessi), soloLettura: ctx.soloLettura };
}

/** Voce senza `permesso`: visibile a tutti (Dashboard, Profilo). */
export function vede(ctx: NavCtx, p?: Permesso): boolean {
  if (p === undefined) return true;
  return can(toCanCtx(ctx), p);
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
  // Un solo Set per chiamata, non uno per voce.
  const canCtx = toCanCtx(ctx);
  return gruppi
    .map((g) => ({
      ...g,
      items: g.items.filter((i) => i.permesso === undefined || can(canCtx, i.permesso)),
    }))
    .filter((g) => g.items.length > 0);
}
