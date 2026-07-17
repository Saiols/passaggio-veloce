/**
 * Logica pura dello "Storico decisioni recenti" dell'inbox agenzia.
 * Estratta dalla pagina (RSC) per poterla testare e riusare.
 */

// Esiti mostrati nello storico: oltre a quelle rifiutate/non vinte, anche le
// ACCETTATA. ASSEGNATA_ALTRO = un'altra agenzia ha preso la pratica prima;
// TIMEOUT = scaduta senza decisione.
export const STORICO_ESITI = ['ACCETTATA', 'RIFIUTATA', 'ASSEGNATA_ALTRO', 'TIMEOUT'] as const;

// Finestra temporale dello storico: ultimi 7 giorni.
export const STORICO_GIORNI = 7;

/** Istante di taglio dello storico: `STORICO_GIORNI` giorni prima di `now`. */
export function storicoCutoff(now: Date): Date {
  return new Date(now.getTime() - STORICO_GIORNI * 24 * 60 * 60 * 1000);
}

/**
 * Etichetta dell'esito per l'agenzia. Dal punto di vista dell'agenzia una
 * pratica non vinta è "Rifiutata", sia che l'abbia rifiutata esplicitamente
 * (RIFIUTATA) sia che sia stata assegnata ad un'altra agenzia (ASSEGNATA_ALTRO,
 * prima mostrata come "Ad altra").
 */
export function labelEsito(e: string): string {
  if (e === 'ACCETTATA') return 'Accettata';
  if (e === 'RIFIUTATA' || e === 'ASSEGNATA_ALTRO') return 'Rifiutata';
  if (e === 'TIMEOUT') return 'Scaduta';
  if (e === 'REVOCATA_ADMIN') return 'Revocata';
  return e.toLowerCase();
}
