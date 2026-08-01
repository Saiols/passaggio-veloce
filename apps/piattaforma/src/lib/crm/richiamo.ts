/**
 * Richiamo programmato di un contatto CRM. Modulo PURO.
 *
 * MODELLO A TRE ASSI (dal 2026-08): il richiamo NON è più uno stato del funnel
 * (`status = S11`), ma un asse indipendente che vive su `nextContactAt` /
 * `nextContactFascia`. `status` porta solo i FATTI (funnel oggettivo), `giudizio`
 * il giudizio soggettivo (Interessato/Non interessato), e il richiamo è "ho un
 * `nextContactAt` da lavorare". Così un contatto può avere insieme un fatto, un
 * giudizio e un richiamo, e mandare la mail / aprire il link avanza `status`
 * senza toccare il richiamo — il bug per cui un "da richiamare" restava
 * incastrato è sparito con la separazione.
 *
 * La lista "Da richiamare" e il calendario filtrano su
 * `nextContactAt <= soglia AND iscrizioneComp = false`: chi si registra sparisce
 * dai richiami senza dover azzerare nulla nelle write path automatiche, che
 * restano intatte.
 *
 * `STATO_RICHIAMARE`/`campiRichiamoDopoCambioStato` restano per compatibilità
 * (nessun contatto è più in S11 dopo la migration), ma il richiamo si imposta e
 * si rimuove con `updateCrmContactRichiamoAction`, non cambiando `status`.
 */
import { romeYmd, romeEndOfDay } from '@/lib/date/rome-day';

/** Legacy: vecchio stato del funnel che portava il richiamo. Vedi header. */
export const STATO_RICHIAMARE = 'S11';

export type FasciaRichiamo = 'MATTINA' | 'POMERIGGIO';

/** Minuscole: finiscono in coda al giorno ("mar 4 ago · mattina"). */
export const LABEL_FASCIA: Record<FasciaRichiamo, string> = {
  MATTINA: 'mattina',
  POMERIGGIO: 'pomeriggio',
};

/**
 * Opzioni della tendina. Il valore vuoto è "Indifferente": l'assenza di fascia
 * non è un terzo membro dell'enum, è il fatto che nessuno ne abbia chiesta una.
 */
export const OPZIONI_FASCIA: Array<{ value: string; label: string }> = [
  { value: '', label: 'Indifferente' },
  { value: 'MATTINA', label: 'Mattina' },
  { value: 'POMERIGGIO', label: 'Pomeriggio' },
];

/**
 * Campi da aggiungere alla `data` di un update che cambia lo stato.
 *
 * L'azzeramento è sulla TRANSIZIONE (si esce da S11), non sullo stato finale:
 * azzerare ogni volta che lo stato salvato non è S11 cancellerebbe la data che
 * un admin ha messo a mano su un contatto S3, a ogni salvataggio della scheda.
 */
export function campiRichiamoDopoCambioStato(
  precedente: string,
  nuovo: string,
): { nextContactAt?: null; nextContactFascia?: null } {
  if (precedente === STATO_RICHIAMARE && nuovo !== STATO_RICHIAMARE) {
    return { nextContactAt: null, nextContactFascia: null };
  }
  return {};
}

/** Bound `lte` per «richiamo dovuto oggi o prima», in giorni romani. */
export function sogliaRichiamoDovuto(adesso: Date): Date {
  return romeEndOfDay(romeYmd(adesso));
}

const FMT_GIORNO = new Intl.DateTimeFormat('it-IT', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  timeZone: 'Europe/Rome',
});

/** -1 se a viene prima di b, 0 se stesso giorno, 1 se dopo. */
function confrontaGiorni(a: [number, number, number], b: [number, number, number]): number {
  for (let i = 0; i < 3; i++) {
    if (a[i]! !== b[i]!) return a[i]! < b[i]! ? -1 : 1;
  }
  return 0;
}

/**
 * Etichetta della riga sotto lo stato, con la posizione nel tempo.
 *
 * Il confronto è fra GIORNI DI CALENDARIO romani, non fra istanti: così non
 * dipende dall'ora a cui il giorno è stato memorizzato né dall'ora legale.
 */
export function etichettaRichiamo(
  giorno: Date | string,
  fascia: string | null,
  adesso: Date,
): { testo: string; scaduto: boolean; oggi: boolean } {
  const d = giorno instanceof Date ? giorno : new Date(giorno);
  const label = LABEL_FASCIA[fascia as FasciaRichiamo];
  const testo = label ? `${FMT_GIORNO.format(d)} · ${label}` : FMT_GIORNO.format(d);
  const cmp = confrontaGiorni(romeYmd(d), romeYmd(adesso));
  return { testo, scaduto: cmp < 0, oggi: cmp === 0 };
}
