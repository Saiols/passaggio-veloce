/**
 * Colonna "Sede" della lista pratiche — logica pura (niente IO, niente Prisma).
 *
 * La colonna mostra sempre la sede dell'AGENZIA assegnataria, cioè la filiale
 * dove la pratica si svolge: non la sede di chi guarda.
 */

/** Valore del filtro per le pratiche non ancora assegnate a una sede. */
export const SEDE_NON_ASSEGNATA = 'nessuna';

/**
 * La colonna serve solo dove può assumere valori diversi riga per riga.
 *
 * - broker: le sedi agenzia variano sempre, indipendentemente dal suo scope;
 * - agenzia: solo se vede più di una sede propria. `resolveCurrentSede`
 *   restituisce sempre `ONE` ai non-owner, quindi `scopeIds.length === 1` copre
 *   in un colpo solo admin di sede, operatore e owner con una filiale sola —
 *   tutti casi in cui ogni riga mostrerebbe la stessa sede.
 */
export function mostraColonnaSede(args: {
  companyType: string | undefined;
  scopeIds: string[];
}): boolean {
  if (args.companyType === 'AGENZIA') return args.scopeIds.length > 1;
  return true;
}

export type FiltroSede =
  | { tipo: 'nessuno' }
  | { tipo: 'sede'; sedeIds: string[] }
  | { tipo: 'nonAssegnata' };

/**
 * Traduce `?sede=` in un vincolo su `agenziaSedeId`, fail-closed.
 *
 * Il valore arriva dalla querystring: un id fuori dalle opzioni ammesse viene
 * ignorato (`nessuno`), non applicato alla cieca. È questa la difesa contro un id
 * ostile — chi passa la sede di un'altra azienda vede la propria lista non
 * filtrata, mai dati altrui.
 *
 * L'intersezione con `scopeIds` per l'agenzia è difesa in profondità: oggi le
 * opzioni derivano già dallo scope, quindi `sedeIds` non può risultare vuoto per
 * questa via. Se un domani le opzioni venissero da una fonte più larga, il filtro
 * continuerebbe a clampare allo scope — la sede restringe la madre, non la
 * rimpiazza — invece di allargare i risultati.
 *
 * `scopeIds` è `null` per broker e admin: lì `agenziaSedeId` non è il campo su
 * cui poggia lo scoping, quindi non c'è nulla da intersecare.
 */
export function filtroSede(args: {
  selezione: string | undefined;
  opzioniIds: string[];
  scopeIds: string[] | null;
  consentiNonAssegnata: boolean;
}): FiltroSede {
  const sel = args.selezione?.trim();
  if (!sel) return { tipo: 'nessuno' };

  if (sel === SEDE_NON_ASSEGNATA) {
    // Per l'agenzia è vietata: `agenziaSedeId: null` sovrascriverebbe il
    // vincolo `{ in: scopeIds }`. E una pratica senza sede non è comunque sua.
    return args.consentiNonAssegnata ? { tipo: 'nonAssegnata' } : { tipo: 'nessuno' };
  }

  if (!args.opzioniIds.includes(sel)) return { tipo: 'nessuno' };

  if (args.scopeIds) return { tipo: 'sede', sedeIds: args.scopeIds.filter((id) => id === sel) };
  return { tipo: 'sede', sedeIds: [sel] };
}
