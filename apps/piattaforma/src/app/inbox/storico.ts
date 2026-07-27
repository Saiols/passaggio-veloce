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
 * Esiti che, dentro un ciclo, testimoniano che QUALCUNO ha accettato la
 * pratica. `REVOCATA_ADMIN` è compreso: è un'accettazione che l'admin ha poi
 * annullato, ma nel momento in cui la nostra assegnazione si è chiusa la
 * pratica era stata presa da un altro — ed è quello che l'etichetta racconta.
 */
const ESITI_DI_ACCETTAZIONE = ['ACCETTATA', 'REVOCATA_ADMIN'];

/**
 * Nel ciclo di questa assegnazione, un'altra l'ha spuntata.
 *
 * Si guarda alle assegnazioni sorelle e NON allo stato corrente della pratica
 * (`agenziaAssegnataId`), che non è affidabile a posteriori: la revoca admin
 * sgancia l'agenzia e rimette la pratica in distribuzione con un ciclo nuovo,
 * quindi una pratica che avevamo perso davvero risulterebbe "di nessuno".
 * L'esito delle sorelle del NOSTRO ciclo, invece, non cambia più.
 */
export function vintaDaAltri(
  ciclo: number,
  assegnazioniDellaPratica: readonly { ciclo: number; esito: string }[],
): boolean {
  return assegnazioniDellaPratica.some(
    (a) => a.ciclo === ciclo && ESITI_DI_ACCETTAZIONE.includes(a.esito),
  );
}

/**
 * Etichetta dell'esito per l'agenzia.
 *
 * `ASSEGNATA_ALTRO` non ha un solo significato: il DB lo scrive sia quando un
 * altro accetta (`inbox/actions.ts`) sia quando la pratica viene chiusa mentre
 * era ancora in distribuzione — annullamento del broker (`pratiche/actions.ts`)
 * o segnalazione confermata (`lib/penali/segnalazione.ts`). Sono due cose
 * diverse per chi legge: nella prima siamo arrivati secondi, nella seconda non
 * c'era più niente da vincere. Da qui "Persa" e "Annullata".
 *
 * "Rifiutata" resta al solo rifiuto esplicito: l'unico caso in cui la decisione
 * è stata nostra.
 *
 * Il contesto è un parametro OBBLIGATORIO e non un default: un chiamante che si
 * dimentica di calcolarlo deve rompere il typecheck, non silenziosamente
 * etichettare "Annullata" ogni pratica persa.
 */
export function labelEsito(e: string, ctx: { vintaDaAltri: boolean }): string {
  if (e === 'ACCETTATA') return 'Accettata';
  if (e === 'RIFIUTATA') return 'Rifiutata';
  if (e === 'ASSEGNATA_ALTRO') return ctx.vintaDaAltri ? 'Persa' : 'Annullata';
  if (e === 'TIMEOUT') return 'Scaduta';
  if (e === 'REVOCATA_ADMIN') return 'Revocata';
  return e.toLowerCase();
}
