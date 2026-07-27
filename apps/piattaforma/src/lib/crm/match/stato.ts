/**
 * Funnel CRM: ordine degli stati e regole di allineamento di un contatto
 * agganciato a un'azienda registrata. Modulo PURO.
 *
 * Questa è la SOLA definizione dell'ordine del funnel in tutto il modulo CRM.
 * Prima viveva in tre punti diversi — `apply.ts` (l'array ORDINE),
 * `sync.ts` (le costanti S8/S9 scritte a mano dentro `onPraticaFirmata`) e
 * `util.ts#isPreIscrizione` (l'elenco S0..S6) — e le copie erano già
 * divergenti nei fatti: `onPraticaFirmata` scriveva S8 anche su un contatto
 * già a S9 (retrocessione) o addirittura a S10 (churn deciso da un umano),
 * perché non passava di qui.
 */

/**
 * Ordine di avanzamento. S10 (churned) è fuori dalla scala apposta: non è uno
 * stato "più avanti" di S9, è un'uscita decisa da una persona e nessun
 * automatismo la può revocare.
 */
export const ORDINE = [
  'S0', 'S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8', 'S9',
] as const;

/**
 * Stato del contatto dato lo stato attuale e le pratiche firmate dall'azienda.
 * Mai indietro; S10 (churn, decisione umana) non si tocca.
 */
export function statoAllineato(attuale: string, firmate: number): string {
  if (attuale === 'S10') return 'S10';
  const target = firmate === 0 ? 'S7' : firmate === 1 ? 'S8' : 'S9';
  const iAttuale = ORDINE.indexOf(attuale as (typeof ORDINE)[number]);
  const iTarget = ORDINE.indexOf(target as (typeof ORDINE)[number]);
  if (iAttuale === -1) return target;
  return iAttuale > iTarget ? attuale : target;
}

/** Fotografia dell'azienda registrata dietro a un contatto agganciato. */
export type Storico = {
  firmate: number;
  primaPraticaAt: Date | null;
  sospesa: boolean;
  referral: boolean;
};

export type DatiFunnel = {
  status: string;
  platStatus: 'ATTIVO' | 'INATTIVO' | 'SOSPESO';
  primaPratica: boolean;
  primaPraticaAt: Date | null;
};

/**
 * I quattro campi che raccontano il punto del funnel di un contatto
 * agganciato. Fonte unica per i due write path che li toccano: l'aggancio
 * (`apply.ts`) e la firma di una pratica (`sync.ts#onPraticaFirmata`).
 * Tenerli in un posto solo è ciò che impedisce alla firma di disfare le
 * garanzie dell'aggancio (S10 intoccabile, nessuna retrocessione, SOSPESO
 * per le aziende sospese o cancellate).
 */
export function datiFunnel(attuale: string, s: Storico): DatiFunnel {
  return {
    status: statoAllineato(attuale, s.firmate),
    platStatus: s.sospesa ? 'SOSPESO' : s.firmate > 0 ? 'ATTIVO' : 'INATTIVO',
    primaPratica: s.firmate > 0,
    primaPraticaAt: s.primaPraticaAt,
  };
}
