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
export const ART_APPROVAZIONE_SPECIFICA = 19;

/**
 * Clausole che l'Utente approva specificamente con la seconda spunta in
 * registrazione. Ordinate, senza duplicati, tutte < ART_APPROVAZIONE_SPECIFICA.
 */
export const CLAUSOLE_VESSATORIE = [3, 5, 7, 8, 10, 11, 12, 13, 17, 18] as const;

/**
 * Descrizione sintetica di ogni clausola vessatoria, per il render dell'art. 19
 * (`app/termini/page.tsx`). Le CHIAVI devono coprire esattamente
 * CLAUSOLE_VESSATORIE: se manca una chiave il render mostra `undefined`, se ne
 * avanza una è una descrizione orfana di una clausola non più vessatoria.
 * `clausole-vessatorie.test.ts` blinda questa invariante confrontando le due
 * chiavi — non fidarsi solo dell'occhio.
 */
export const DESCRIZIONI_VESSATORIE: Record<(typeof CLAUSOLE_VESSATORIE)[number], string> = {
  3: 'variazione del prezzo del servizio a discrezione del Gestore',
  5: 'condizioni e soglia di prelievo del wallet (payout)',
  7: 'determinazione differenziata del compenso in base al regime fiscale',
  8: 'manleva in materia di visura camerale',
  10: 'sistema di segnalazioni e penali',
  11: 'potere di attestazione della firma da parte del Gestore',
  12: 'limitazione operativa, sospensione e cancellazione dell’account',
  13: 'limitazioni di responsabilità',
  17: 'garanzia e manleva sui dati di venditori e acquirenti',
  18: 'deroga alla competenza territoriale (foro esclusivo)',
};

/**
 * Versione dei Termini in vigore, persistita su `Company.termsVersion` al
 * momento dell'accettazione: senza, non sappiamo QUALE testo l'utente ha
 * accettato. Aggiornare a ogni modifica sostanziale della pagina /termini.
 */
export const TERMS_VERSION = '2026-07-14';

/** L'elenco come lo legge l'utente: "3, 5, 7, 8, 10, 11, 12, 13, 17, 18". */
export function elencoClausoleVessatorie(): string {
  return CLAUSOLE_VESSATORIE.join(', ');
}

/**
 * Le descrizioni nell'ordine dell'elenco, per la parentesi della checkbox in
 * registrazione: "prezzo del servizio…, …, deroga alla competenza territoriale
 * (foro esclusivo)".
 *
 * Era prosa scritta a mano accanto a un elenco di numeri generato: 10 numeri e
 * 9 descrizioni sarebbero bastati a far approvare "specificamente" (art. 1341
 * c.c.) una clausola che la checkbox non nominava. Generandola, non può più
 * divergere dall'elenco.
 */
export function elencoDescrizioniVessatorie(): string {
  return CLAUSOLE_VESSATORIE.map((n) => DESCRIZIONI_VESSATORIE[n]).join(', ');
}
