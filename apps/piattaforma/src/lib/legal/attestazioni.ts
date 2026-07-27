/**
 * FONTE UNICA dei testi delle attestazioni spuntate dal broker prima di
 * inviare una pratica (modale `components/dichiarazione-popup.tsx`).
 *
 * Il record `BrokerDichiarazione` persiste la VERSIONE e, dalla v4.0, anche il
 * TESTO. Il registro tiene comunque tutte le versioni storiche: e' l'unico modo
 * di rendere leggibili i record scritti prima che il testo fosse persistito.
 *
 * ⚠️ I testi sono stringhe LETTERALI. Non interpolare mai `ART_DATI_TERZI`:
 * una rinumerazione dei Termini cambierebbe retroattivamente il significato di
 * una versione gia' persistita. Al suo posto, `attestazioni.test.ts` verifica
 * che il testo corrente citi il numero attuale — cosi' una rinumerazione
 * rompe il test e obbliga a una versione nuova.
 *
 * Storico delle versioni (prima viveva in `lib/penali/config.ts`, lontano dal
 * testo che descriveva):
 *  - v2.0 (2026-07-11) penale €25 per veicolo segnalato, non per pratica.
 *  - v3.0 (2026-07-14) aggiunta la conferma di aver informato venditore e
 *    acquirente (allora clausola 17 dei Termini).
 *  - v3.1 (2026-07-26) stesso testo, clausola rinumerata 17 → 23 col merge del
 *    documento v8.
 *  - v4.0 (2026-07-27) la spunta si divide in DUE: responsabilita' sul veicolo
 *    e attestazione sull'informativa ai terzi, con rimando all'Informativa per
 *    venditori e acquirenti. Da questa versione il testo e' persistito.
 */

export const ATTESTAZIONI_VERSION = 'v4.0';

/** `CUMULATIVA` esiste solo nelle versioni ≤ v3.1, dove la spunta era una sola. */
export type IdAttestazione = 'CUMULATIVA' | 'RESPONSABILITA' | 'TERZI';

export type Attestazione = {
  id: IdAttestazione;
  /** Testo integrale reso a schermo e persistito. Stringa letterale. */
  testo: string;
  /** Rimando cliccabile mostrato sotto la spunta. Non fa parte del testo persistito. */
  link?: { href: string; label: string };
};

export const REGISTRO_ATTESTAZIONI: Record<string, readonly Attestazione[]> = {
  // Storiche, congelate: servono solo a rendere leggibili i record gia' scritti.
  'v3.0': [
    {
      id: 'CUMULATIVA',
      testo:
        'Confermo di aver verificato quanto sopra, di aver informato venditore e ' +
        'acquirente sul trattamento dei loro dati (clausola 17 dei Termini) e mi assumo ' +
        'piena responsabilità',
    },
  ],
  'v3.1': [
    {
      id: 'CUMULATIVA',
      testo:
        'Confermo di aver verificato quanto sopra, di aver informato venditore e ' +
        'acquirente sul trattamento dei loro dati (clausola 23 dei Termini) e mi assumo ' +
        'piena responsabilità',
    },
  ],
  'v4.0': [
    {
      id: 'RESPONSABILITA',
      testo:
        'Confermo di aver verificato quanto sopra (assenza di fermi amministrativi, ' +
        'ipoteche o vincoli iscritti al PRA, autenticità dei documenti caricati) e mi ' +
        'assumo piena responsabilità.',
    },
    {
      id: 'TERZI',
      testo:
        "Dichiaro di aver informato il venditore e l'acquirente che i loro documenti e " +
        'dati personali saranno trattati da Passaggio Veloce S.r.l. per la gestione della ' +
        "presente pratica, ai sensi dell'Informativa Privacy per venditori e acquirenti " +
        '(passaggioveloce.it/privacy/clienti) e della clausola 23 dei Termini.',
      link: { href: '/privacy/clienti', label: 'Informativa per venditori e acquirenti' },
    },
  ],
};

/**
 * Testi di una versione, o `null` se sconosciuta. Il chiamante server DEVE
 * trattare `null` come richiesta da rifiutare: registrare un'attestazione di
 * cui non conosciamo il contenuto non e' una prova.
 */
export function attestazioniPerVersione(versione: string): readonly Attestazione[] | null {
  return REGISTRO_ATTESTAZIONI[versione] ?? null;
}

/** Le attestazioni da rendere adesso nella modale. */
export function attestazioniCorrenti(): readonly Attestazione[] {
  return REGISTRO_ATTESTAZIONI[ATTESTAZIONI_VERSION]!;
}
