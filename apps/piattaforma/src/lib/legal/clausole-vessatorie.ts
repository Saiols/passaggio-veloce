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
export const ART_APPROVAZIONE_SPECIFICA = 25;

/**
 * Numero della clausola che disciplina i dati di venditori, acquirenti e
 * altri terzi (ruoli, garanzia dell'Utente, informativa di Passaggio Veloce,
 * minimizzazione, manleva). Citata testualmente nella label della checkbox
 * del popup di responsabilità broker (components/dichiarazione-popup.tsx) —
 * una dichiarazione che viene REGISTRATA su DB (`BrokerDichiarazione`) a ogni
 * invio pratica. Un numero scritto a mano dentro un record persistito non si
 * corregge retroattivamente: a ogni rinumerazione dei Termini (è già successo
 * tre volte: foro 17→18 e approvazione 18→19; poi dati terzi 17→23, foro
 * 18→24 e approvazione 19→25 col merge del documento v8 del 2026-07-26), le
 * dichiarazioni pregresse citerebbero per sempre la clausola sbagliata se non
 * leggessero questa costante. Il record persiste `popupVersion`
 * (`PENALI.POPUP_VERSION`) e NON il testo: **bumpare quella versione a ogni
 * rinumerazione**, altrimenti due testi diversi finiscono sotto la stessa
 * versione e l'audit non sa quale numero di clausola l'utente ha letto.
 */
export const ART_DATI_TERZI = 23;

/**
 * Clausole che l'Utente approva specificamente con la seconda spunta in
 * registrazione. Ordinate, senza duplicati, tutte < ART_APPROVAZIONE_SPECIFICA.
 */
export const CLAUSOLE_VESSATORIE = [3, 5, 6, 7, 8, 10, 11, 12, 13, 15, 16, 23, 24] as const;

/**
 * Descrizione sintetica di ogni clausola vessatoria, per il render dell'art. 25
 * (`app/termini/page.tsx`). Le CHIAVI devono coprire esattamente
 * CLAUSOLE_VESSATORIE: se manca una chiave il render mostra `undefined`, se ne
 * avanza una è una descrizione orfana di una clausola non più vessatoria.
 * `clausole-vessatorie.test.ts` blinda questa invariante confrontando le due
 * chiavi — non fidarsi solo dell'occhio.
 */
export const DESCRIZIONI_VESSATORIE: Record<(typeof CLAUSOLE_VESSATORIE)[number], string> = {
  3: 'variazione del prezzo del servizio, tetto massimo di 200 € e preavvisi differenziati',
  5: 'condizioni e soglia di prelievo del wallet (payout) e condizioni sui bonus promozionali',
  6: 'mandato di fatturazione delegata e conferma OTP al primo payout',
  7: 'determinazione differenziata del compenso in base al regime fiscale',
  8: 'aggiornamento e manleva in materia di visura camerale',
  10: 'sistema di segnalazioni, penali e termini di verifica',
  11: 'potere di attestazione della firma da parte del Gestore',
  12: 'limitazione operativa, sospensione e cancellazione dell’account',
  13: 'limitazioni di responsabilità',
  15: 'proprietà intellettuale e divieto di reverse engineering',
  16: 'riservatezza dei dati commerciali e divieto di elusione della Piattaforma',
  23: 'garanzia, responsabilità e manleva sui dati di venditori e acquirenti',
  24: 'deroga alla competenza territoriale (foro esclusivo)',
};

/**
 * Versione dei Termini in vigore, persistita su `Company.termsVersion` al
 * momento dell'accettazione: senza, non sappiamo QUALE testo l'utente ha
 * accettato. Aggiornare a ogni modifica sostanziale della pagina /termini.
 */
export const TERMS_VERSION = '2026-07-26';

/** L'elenco come lo legge l'utente: "3, 5, 6, 7, 8, 10, …". */
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
