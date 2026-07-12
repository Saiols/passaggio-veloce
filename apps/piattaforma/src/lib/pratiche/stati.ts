import type { PraticaStato } from '@pv/db';

/**
 * Classificazione degli stati pratica per la UI. FONTE UNICA: la usano sia i tab
 * della lista (`/pratiche`) sia il badge di navigazione (`/api/badges`). Prima
 * la definizione viveva solo dentro la route del badge come lista di esclusi:
 * due definizioni separate = badge e tab che mostrano numeri diversi.
 *
 * `stati.test.ts` blinda l'invariante: ogni valore dell'enum Prisma deve cadere
 * in ESATTAMENTE uno tra BOZZA / IN_CORSO / CONCLUSI. Se domani viene aggiunto
 * uno stato senza classificarlo, il test diventa rosso invece di farlo sparire
 * in silenzio dai conteggi.
 */

/** Round di distribuzione + escalation: per l'utente sono tutti "In attesa". */
export const STATI_IN_ATTESA = [
  'IN_ATTESA_ROUND_1',
  'IN_ATTESA_ROUND_2',
  'IN_ATTESA_ROUND_3',
  'IN_ESCALATION',
] as const satisfies readonly PraticaStato[];

/** Pratiche vive: inviate e non ancora concluse. Nessuna bozza. */
export const STATI_IN_CORSO = [
  ...STATI_IN_ATTESA,
  'ACCETTATA',
  'PROCESSATA',
] as const satisfies readonly PraticaStato[];

/** Terminali: nessuna azione attesa, né dal broker né dall'agenzia. */
export const STATI_CONCLUSI = [
  'FIRMATA',
  'ANNULLATA',
  'SCADUTA',
] as const satisfies readonly PraticaStato[];

export function isInCorso(stato: PraticaStato): boolean {
  return (STATI_IN_CORSO as readonly PraticaStato[]).includes(stato);
}

/**
 * Valori ammessi per `?stato=`. Gli aggregati (IN_CORSO, CONCLUSE, IN_ATTESA)
 * espandono su più stati DB; gli altri filtrano per uguaglianza.
 *
 * R1/R2/R3 ed escalation NON sono selezionabili singolarmente: sono dettagli
 * interni al motore di distribuzione e non vanno esposti all'utente (la lista
 * completa resta in /admin/pratiche).
 */
export const SINGOLI = [
  'BOZZA',
  'ACCETTATA',
  'PROCESSATA',
  'FIRMATA',
  'SCADUTA',
  'ANNULLATA',
] as const satisfies readonly PraticaStato[];

export function whereStato(
  param: string | undefined,
): PraticaStato | { in: PraticaStato[] } | undefined {
  if (!param) return undefined;
  if (param === 'IN_CORSO') return { in: [...STATI_IN_CORSO] };
  if (param === 'CONCLUSE') return { in: [...STATI_CONCLUSI] };
  if (param === 'IN_ATTESA') return { in: [...STATI_IN_ATTESA] };
  if ((SINGOLI as readonly string[]).includes(param)) return param as PraticaStato;
  // Valore non riconosciuto (URL manomesso): nessun filtro, come se non ci fosse.
  return undefined;
}

export type ConteggiTab = {
  tutte: number;
  inCorso: number;
  bozze: number;
  concluse: number;
};

/** Riduce il risultato di `prisma.pratica.groupBy({ by: ['stato'] })` ai 4 gruppi dei tab. */
export function contaGruppi(
  rows: { stato: PraticaStato; _count: { _all: number } }[],
): ConteggiTab {
  const out: ConteggiTab = { tutte: 0, inCorso: 0, bozze: 0, concluse: 0 };
  for (const r of rows) {
    const n = r._count._all;
    out.tutte += n;
    if (r.stato === 'BOZZA') out.bozze += n;
    else if (isInCorso(r.stato)) out.inCorso += n;
    else out.concluse += n;
  }
  return out;
}
