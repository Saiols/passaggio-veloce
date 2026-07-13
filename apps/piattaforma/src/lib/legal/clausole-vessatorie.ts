/**
 * FONTE UNICA dei numeri delle clausole dei Termini citati altrove.
 *
 * Prima esistevano due elenchi scritti a mano — nel testo dell'articolo di
 * approvazione specifica (`app/termini/page.tsx`) e nella checkbox di
 * registrazione (`register-wizard.tsx`) — più nove occorrenze del rimando
 * "v. clausola N" sparse nel testo. Aggiungere una clausola vessatoria
 * significava tenere allineati a mano undici punti: la ricetta esatta per un
 * contratto che si contraddice da solo.
 */

/** Numero dell'articolo di approvazione specifica ex artt. 1341-1342 c.c. */
export const ART_APPROVAZIONE_SPECIFICA = 18;

/**
 * Clausole che l'Utente approva specificamente con la seconda spunta in
 * registrazione. Ordinate, senza duplicati, tutte < ART_APPROVAZIONE_SPECIFICA.
 */
export const CLAUSOLE_VESSATORIE = [3, 5, 7, 8, 10, 11, 12, 13, 17] as const;

/**
 * Versione dei Termini in vigore, persistita su `Company.termsVersion` al
 * momento dell'accettazione: senza, non sappiamo QUALE testo l'utente ha
 * accettato. Aggiornare a ogni modifica sostanziale della pagina /termini.
 */
export const TERMS_VERSION = '2026-07-13';

/** L'elenco come lo legge l'utente: "3, 5, 7, 8, 10, 11, 12, 13, 17". */
export function elencoClausoleVessatorie(): string {
  return CLAUSOLE_VESSATORIE.join(', ');
}
