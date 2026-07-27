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
 * Il numero di clausola sui dati di terzi (`clausolaTerzi` in
 * `VersioneAttestazioni`, sotto) e' anch'esso PER VERSIONE, non una costante
 * viva letta a parte: il chiamante che scrive `BrokerDichiarazione` deve
 * prenderlo dalla stessa versione da cui prende il testo (Finding 2, review
 * whole-branch 2026-07-27) — altrimenti un record scritto con una versione
 * storica avrebbe un testo che cita un numero e un campo `clausolaTerzi` che
 * ne cita un altro.
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

/**
 * Una versione del registro: le attestazioni (testo letterale) e il numero
 * di clausola dei Termini che QUEL testo cita in materia di dati di
 * venditori/acquirenti. `clausolaTerzi` vive qui, non in una costante viva
 * importata a parte: il chiamante che scrive `BrokerDichiarazione` deve
 * leggerlo dalla STESSA versione da cui legge il testo, altrimenti meta'
 * record e' congelata alla versione dichiarata e meta' e' "attuale al
 * momento della scrittura" — le due possono contraddirsi (Finding 2, review
 * whole-branch 2026-07-27).
 */
export type VersioneAttestazioni = {
  attestazioni: readonly Attestazione[];
  clausolaTerzi: number;
};

export const REGISTRO_ATTESTAZIONI: Record<string, VersioneAttestazioni> = {
  // Storiche, congelate: servono solo a rendere leggibili i record gia' scritti.
  'v3.0': {
    attestazioni: [
      {
        id: 'CUMULATIVA',
        testo:
          'Confermo di aver verificato quanto sopra, di aver informato venditore e ' +
          'acquirente sul trattamento dei loro dati (clausola 17 dei Termini) e mi assumo ' +
          'piena responsabilità',
      },
    ],
    clausolaTerzi: 17,
  },
  'v3.1': {
    attestazioni: [
      {
        id: 'CUMULATIVA',
        testo:
          'Confermo di aver verificato quanto sopra, di aver informato venditore e ' +
          'acquirente sul trattamento dei loro dati (clausola 23 dei Termini) e mi assumo ' +
          'piena responsabilità',
      },
    ],
    clausolaTerzi: 23,
  },
  'v4.0': {
    attestazioni: [
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
    clausolaTerzi: 23,
  },
};

/**
 * Versione di una attestazione, o `null` se sconosciuta. Il chiamante server DEVE
 * trattare `null` come richiesta da rifiutare: registrare un'attestazione di
 * cui non conosciamo il contenuto non e' una prova.
 *
 * Usa Object.hasOwn per evitare prototype pollution: una stringa come
 * 'constructor' proveniente dal client non deve accedere a Object.prototype.
 */
export function attestazioniPerVersione(versione: string): VersioneAttestazioni | null {
  return Object.hasOwn(REGISTRO_ATTESTAZIONI, versione) ? REGISTRO_ATTESTAZIONI[versione]! : null;
}

/** Le attestazioni da rendere adesso nella modale. */
export function attestazioniCorrenti(): readonly Attestazione[] {
  return REGISTRO_ATTESTAZIONI[ATTESTAZIONI_VERSION]!.attestazioni;
}

/**
 * Campo FormData che porta la spunta di una data attestazione. CUMULATIVA
 * (storica, un'unica spunta) e RESPONSABILITA condividono lo stesso campo:
 * sono la stessa spunta a livelli di versione diversi (v3.1 ne aveva una
 * sola; v4.0 l'ha scissa in due, ma quella "principale" e' rimasta sullo
 * stesso campo `dichiarazioneAccettata` per compatibilita' col client
 * storico — vedi `tutteLeAttestazioniAccettate` sotto).
 */
const CAMPO_PER_ATTESTAZIONE: Record<
  IdAttestazione,
  'dichiarazioneAccettata' | 'attestazioneTerziAccettata'
> = {
  CUMULATIVA: 'dichiarazioneAccettata',
  RESPONSABILITA: 'dichiarazioneAccettata',
  TERZI: 'attestazioneTerziAccettata',
};

/**
 * Vero se tutti i flag richiesti dalle attestazioni DI QUESTA VERSIONE sono
 * stati accettati. Il requisito e' derivato dal registro (quali id porta la
 * versione), non scritto a mano nel chiamante (Finding 3, review
 * whole-branch 2026-07-27): un browser che tiene ancora un bundle precedente
 * (es. v3.1, una sola spunta cumulativa) non puo' fisicamente mandare un
 * campo che non esisteva ancora — validarlo contro un requisito fisso da due
 * spunte lo respingerebbe a torto, con un messaggio che parla di
 * "dichiarazioni" al plurale a un utente che ne ha vista una sola.
 */
export function tutteLeAttestazioniAccettate(
  attestazioni: readonly Attestazione[],
  flags: { dichiarazioneAccettata: boolean; attestazioneTerziAccettata: boolean },
): boolean {
  return attestazioni.every((a) => flags[CAMPO_PER_ATTESTAZIONE[a.id]] === true);
}
