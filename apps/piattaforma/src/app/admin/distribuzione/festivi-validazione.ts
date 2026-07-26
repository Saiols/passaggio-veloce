import { parseYmd } from '@/lib/date/rome-day';
import type { Festivo } from '@/lib/distribuzione/calendario';

/**
 * Perché il tentativo di aggiungere un festivo dall'editor va respinto.
 * `null` (nessuno di questi) = il tentativo è valido, si può aggiungere.
 */
export type EsitoAggiuntaFestivo = 'data-invalida' | 'nome-mancante' | 'data-duplicata';

/**
 * Valida un tentativo di aggiunta a un elenco di festivi, prima di toccare lo
 * stato del form. Pura e testabile: la UI (`festivi.tsx`) si limita a
 * mostrare il messaggio corrispondente e a cancellarlo quando l'utente
 * corregge l'input, senza duplicare qui la logica di validazione.
 *
 * L'ordine dei controlli conta: una data malformata va segnalata come tale
 * prima di cercarla nell'elenco (cercare "non-una-data" fra le stringhe
 * `YYYY-MM-DD` esistenti non avrebbe senso).
 */
export function validaAggiuntaFestivo(
  esistenti: Festivo[],
  data: string,
  nome: string,
): EsitoAggiuntaFestivo | null {
  if (!parseYmd(data)) return 'data-invalida';
  if (!nome.trim()) return 'nome-mancante';
  if (esistenti.some((f) => f.data === data)) return 'data-duplicata';
  return null;
}

/** Messaggio da mostrare accanto ai campi di inserimento per ciascun esito. */
export const MESSAGGIO_ESITO_AGGIUNTA: Record<EsitoAggiuntaFestivo, string> = {
  'data-invalida': 'Inserisci una data valida.',
  'nome-mancante': 'Dai un nome al festivo.',
  'data-duplicata': "C'è già un festivo in questa data.",
};
