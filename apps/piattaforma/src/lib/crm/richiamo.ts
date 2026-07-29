/**
 * Richiamo programmato di un contatto CRM (stato S11). Modulo PURO.
 *
 * È la sola definizione di tre cose, e sta in un modulo proprio perché i write
 * path che possono chiudere un richiamo sono QUATTRO, non due: le due server
 * action della vista contatti, l'aggancio del motore di match
 * (`match/apply.ts`) e la firma di una pratica (`sync.ts`). Gli ultimi due
 * passano da `datiFunnel()`, che per uno stato fuori da `ORDINE` — e S11 lo è,
 * come S10 — restituisce direttamente S7/S8/S9: un contatto da richiamare che
 * si registra davvero esce da S11 senza che nessuna action se ne accorga. Se
 * la regola vivesse dentro le action, resterebbe un richiamo fantasma su un
 * cliente già a bordo, e continuerebbe a comparire nel chip "Da richiamare".
 */
import { romeYmd, romeEndOfDay } from '@/lib/date/rome-day';

/** Stato del funnel che porta con sé un richiamo programmato. */
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
function confrontaGiorni(
  a: [number, number, number],
  b: [number, number, number],
): number {
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
