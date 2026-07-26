import type { TariffaRow } from '@/lib/pricing';

/**
 * Clausola 3 dei Termini — variazione del prezzo del servizio.
 *
 * Il prezzo non cambia più nel momento in cui l'admin preme «salva»: la nuova
 * tariffa nasce con una DATA DI EFFICACIA futura, e nel frattempo gli Utenti
 * ricevono la comunicazione via email. Due fasce, come le ha scritte il
 * contratto:
 *
 *   (a) variazioni fino al 20% della tariffa corrente → preavviso 7 giorni;
 *   (b) variazioni superiori al 20%, o modifiche strutturali alle tipologie di
 *       corrispettivo → preavviso 30 giorni + RIACCETTAZIONE esplicita prima
 *       dell'entrata in vigore.
 *
 * Modulo puro: nessun accesso al DB, nessuna data implicita. Il `now` arriva
 * sempre dal chiamante — così il comportamento al confine (esattamente il 20%,
 * la voce che passa da zero) è verificabile senza far finta di essere in un
 * altro giorno.
 */

/** Giorni di preavviso per una variazione fino al 20%. */
export const PREAVVISO_LIEVE_GIORNI = 7;

/** Giorni di preavviso per una variazione oltre il 20% o strutturale. */
export const PREAVVISO_RILEVANTE_GIORNI = 30;

/**
 * Soglia contrattuale, in centesimi di punto percentuale per restare su
 * aritmetica intera: 20% = 2000. Confrontare `|delta| * 10_000` con
 * `corrente * 2000` evita del tutto i float, e quindi il caso in cui una
 * variazione esattamente del 20% cada dalla parte sbagliata per un errore di
 * rappresentazione.
 */
export const SOGLIA_RILEVANTE_BP = 2000;

export type FasciaVariazione = 'NESSUNA' | 'LIEVE' | 'RILEVANTE';

export type VoceVariata = {
  voce: keyof TariffaRow;
  daCent: number;
  aCent: number;
  /** Scostamento in punti base (1% = 100). `null` se la voce partiva da 0. */
  scostamentoBp: number | null;
};

export type Variazione = {
  fascia: FasciaVariazione;
  voci: VoceVariata[];
  /**
   * Il maggiore scostamento fra le voci variate, **in valore assoluto** e
   * quindi sempre >= 0: è il numero che si confronta con la soglia del 20%.
   * Il segno vive sulla singola voce (`voci[].scostamentoBp`), che è ciò che
   * serve all'email per dire se una voce sale o scende. `null` quando almeno
   * una voce parte da 0 e la percentuale non è definita.
   */
  scostamentoMassimoBp: number | null;
  giorniPreavviso: number;
  richiedeRiaccettazione: boolean;
  /** Vero se la fascia è RILEVANTE per la sola dichiarazione di strutturalità. */
  strutturale: boolean;
};

export const VOCI_TARIFFARIO: readonly (keyof TariffaRow)[] = [
  'sempliceFeeAgenziaCent',
  'sempliceCreditoBrokerCent',
  'sempliceAffiliazioneCent',
  'minivolturaFeeAgenziaCent',
  'minivolturaCreditoBrokerCent',
  'minivolturaAffiliazioneCent',
] as const;

/**
 * Scostamento di una singola voce, in punti base sul valore CORRENTE.
 *
 * `null` quando la voce corrente vale 0: la variazione percentuale non è
 * definita, e non è un dettaglio matematico — introdurre un compenso dove
 * prima non c'era nulla (o farlo sparire) è precisamente il caso che la
 * clausola chiama «modifica strutturale alle tipologie di corrispettivo».
 * Chi legge `null` deve trattarlo come RILEVANTE, mai come 0.
 */
export function scostamentoBp(daCent: number, aCent: number): number | null {
  if (daCent === 0) return aCent === 0 ? 0 : null;
  return Math.round(((aCent - daCent) * 10_000) / daCent);
}

/**
 * Confronta la tariffa in vigore con quella proposta e dice quale regime di
 * preavviso si applica.
 *
 * Il verso della variazione non conta: la clausola parla di «variazioni», non
 * di aumenti, e in un tariffario a tre voci non esiste una direzione
 * univocamente favorevole — abbassare la fee dell'agenzia le fa piacere,
 * abbassare il credito del broker no. Si guarda il valore assoluto.
 */
export function calcolaVariazione(
  corrente: TariffaRow,
  nuova: TariffaRow,
  opts: { strutturale?: boolean } = {},
): Variazione {
  const voci: VoceVariata[] = [];
  for (const voce of VOCI_TARIFFARIO) {
    const daCent = corrente[voce];
    const aCent = nuova[voce];
    if (daCent === aCent) continue;
    voci.push({ voce, daCent, aCent, scostamentoBp: scostamentoBp(daCent, aCent) });
  }

  const strutturale = opts.strutturale === true;

  if (voci.length === 0) {
    // Nessun importo cambia: l'admin ha ritoccato solo la nota. Nessun
    // preavviso da dare, nessuna email da mandare, efficacia immediata —
    // altrimenti una correzione di battitura congelerebbe il tariffario per
    // una settimana.
    return {
      fascia: strutturale ? 'RILEVANTE' : 'NESSUNA',
      voci,
      scostamentoMassimoBp: strutturale ? null : 0,
      giorniPreavviso: strutturale ? PREAVVISO_RILEVANTE_GIORNI : 0,
      richiedeRiaccettazione: strutturale,
      strutturale,
    };
  }

  const indefinite = voci.some((v) => v.scostamentoBp === null);
  const massimo = indefinite
    ? null
    : Math.max(...voci.map((v) => Math.abs(v.scostamentoBp as number)));

  const rilevante = strutturale || indefinite || (massimo ?? 0) > SOGLIA_RILEVANTE_BP;

  return {
    fascia: rilevante ? 'RILEVANTE' : 'LIEVE',
    voci,
    scostamentoMassimoBp: massimo,
    giorniPreavviso: rilevante ? PREAVVISO_RILEVANTE_GIORNI : PREAVVISO_LIEVE_GIORNI,
    richiedeRiaccettazione: rilevante,
    strutturale,
  };
}

/**
 * Data di entrata in vigore: `now` più i giorni di preavviso, in millisecondi.
 *
 * Aritmetica sui millisecondi e non sul calendario di Roma di proposito. Il
 * contratto promette un preavviso «minimo» di 7 o 30 giorni: 7×24h di tempo
 * reale soddisfa sempre quel minimo, mentre sommare 7 giorni di calendario
 * attraverso il cambio dell'ora legale ne consegnerebbe 6 giorni e 23 ore —
 * un'ora in meno di quanto scritto nei Termini.
 */
export function efficaciaDal(now: Date, giorniPreavviso: number): Date {
  return new Date(now.getTime() + giorniPreavviso * 24 * 60 * 60 * 1000);
}

/** "15,00%" — per l'email e per la schermata admin. */
export function formatScostamentoBp(bp: number | null): string {
  if (bp === null) return 'non calcolabile (voce introdotta o rimossa)';
  return `${(Math.abs(bp) / 100).toFixed(2).replace('.', ',')}%`;
}

export const ETICHETTE_VOCI: Record<keyof TariffaRow, string> = {
  sempliceFeeAgenziaCent: 'Passaggio semplice — fee a carico dell’agenzia',
  sempliceCreditoBrokerCent: 'Passaggio semplice — compenso del broker',
  sempliceAffiliazioneCent: 'Passaggio semplice — commissione di affiliazione',
  minivolturaFeeAgenziaCent: 'Minivoltura — fee a carico dell’agenzia',
  minivolturaCreditoBrokerCent: 'Minivoltura — compenso del broker',
  minivolturaAffiliazioneCent: 'Minivoltura — commissione di affiliazione',
};
