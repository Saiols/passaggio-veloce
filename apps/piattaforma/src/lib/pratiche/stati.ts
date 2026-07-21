import type { PraticaStato, Prisma } from '@pv/db';

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

/**
 * Round di distribuzione + escalation: per l'utente sono tutti "In attesa".
 *
 * `IN_DISTRIBUZIONE` è lo stato del motore v2 (raggio incrementale): sostituisce
 * il vecchio ciclo ROUND_1→ROUND_2→ROUND_3→ESCALATION con un solo stato che si
 * espande internamente (raggioCorrenteM), quindi va nello stesso gruppo. I tre
 * ROUND_* restano qui in modo difensivo: eventuali righe legacy pre-v2 ancora in
 * quello stato continuano a classificarsi come "in attesa/in corso".
 */
export const STATI_IN_ATTESA = [
  'IN_ATTESA_ROUND_1',
  'IN_ATTESA_ROUND_2',
  'IN_ATTESA_ROUND_3',
  'IN_ESCALATION',
  'IN_DISTRIBUZIONE',
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

/**
 * Valori `?stato=` ammessi per l'ADMIN di piattaforma: tutti, inclusi i round
 * di distribuzione e l'escalation, che al broker restano nascosti (dettagli
 * interni del motore). L'unione con `STATI_IN_ATTESA` copre l'enum: lo garantisce
 * il test "cade in esattamente uno tra SINGOLI e STATI_IN_ATTESA" in stati.test.ts,
 * quindi un nuovo stato dell'enum entra qui automaticamente o rende rosso quel test.
 */
export const SINGOLI_ADMIN = [
  ...SINGOLI,
  ...STATI_IN_ATTESA,
] as const satisfies readonly PraticaStato[];

export function whereStato(
  param: string | undefined,
  ammessi: readonly PraticaStato[] = SINGOLI,
): PraticaStato | { in: PraticaStato[] } | undefined {
  if (!param) return undefined;
  if (param === 'IN_CORSO') return { in: [...STATI_IN_CORSO] };
  if (param === 'CONCLUSE') return { in: [...STATI_CONCLUSI] };
  if (param === 'IN_ATTESA') return { in: [...STATI_IN_ATTESA] };
  if ((ammessi as readonly string[]).includes(param)) return param as PraticaStato;
  // Valore non riconosciuto (URL manomesso): nessun filtro, come se non ci fosse.
  return undefined;
}

export type ConteggiTab = {
  tutte: number;
  inCorso: number;
  /** Sottoinsieme di `inCorso`, non un gruppo a sé: non va sommato in `tutte`. */
  escalation: number;
  bozze: number;
  concluse: number;
};

/** Riduce il risultato di `prisma.pratica.groupBy({ by: ['stato'] })` ai gruppi dei tab. */
export function contaGruppi(
  rows: { stato: PraticaStato; _count: { _all: number } }[],
): ConteggiTab {
  const out: ConteggiTab = { tutte: 0, inCorso: 0, escalation: 0, bozze: 0, concluse: 0 };
  for (const r of rows) {
    const n = r._count._all;
    out.tutte += n;
    if (r.stato === 'BOZZA') out.bozze += n;
    else if (isInCorso(r.stato)) out.inCorso += n;
    else out.concluse += n;
    // Trasversale, non alternativo: l'escalation è già contata in `inCorso`.
    if (r.stato === 'IN_ESCALATION') out.escalation += n;
  }
  return out;
}

/**
 * Il criterio del tab "In attesa di firma": lavorata dall'agenzia, non ferma
 * per una segnalazione, in attesa della sola firma del cliente.
 *
 * `flagSegnalata` basta da solo: sul write path, una PROCESSATA con
 * `flagSegnalata = true` ha sempre `segnalazioneStato = 'RICEVUTA'` (la conferma
 * porta ad ANNULLATA, il respingimento rimette flagSegnalata a false).
 */
export const WHERE_ATTESA_FIRMA = {
  stato: 'PROCESSATA',
  flagSegnalata: false,
} as const satisfies Prisma.PraticaWhereInput;

/**
 * Filtro Prisma di un tab. Superset di `whereStato`: i tab il cui criterio è il
 * solo stato delegano a lei; ATTESA_FIRMA aggiunge la condizione sulla
 * segnalazione, che `whereStato` non sa esprimere (filtra solo `stato`).
 *
 * Senza questa funzione, `whereStato('ATTESA_FIRMA')` tornerebbe `undefined` =
 * NESSUN filtro: il tab mostrerebbe tutte le pratiche, in silenzio.
 */
export function whereTabPratiche(
  param: string | undefined,
  ammessi: readonly PraticaStato[] = SINGOLI,
): Prisma.PraticaWhereInput {
  if (param === 'ATTESA_FIRMA') return { ...WHERE_ATTESA_FIRMA };
  const stato = whereStato(param, ammessi);
  return stato ? { stato } : {};
}
