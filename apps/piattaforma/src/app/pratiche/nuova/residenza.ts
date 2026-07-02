/**
 * Gate residenza di una parte: se la residenza è "uguale al documento" non
 * serve indirizzo; se è "diversa" serve un indirizzo non vuoto. Puro/testabile,
 * riusato per l'acquirente principale e per i co-intestatari.
 */
export function residenzaOk(residenzaDiversa: boolean, indirizzo: string): boolean {
  return !residenzaDiversa || indirizzo.trim().length > 0;
}
