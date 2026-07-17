import type { CrmStatoContatto } from '@pv/db';

const STATI_PRE_INVIO = new Set(['S0', 'S1', 'S2', 'S3']);
const STATI_PRE_APERTURA = new Set(['S0', 'S1', 'S2', 'S3', 'S4']);

/** Avanza lo stato a S4 (link inviato) solo se non è un declassamento. */
export function nextStatoInvio(current: string): CrmStatoContatto {
  return (STATI_PRE_INVIO.has(current) ? 'S4' : current) as CrmStatoContatto;
}

/** Avanza lo stato a S5 (link aperto) solo se non è un declassamento. */
export function nextStatoApertura(current: string): CrmStatoContatto {
  return (STATI_PRE_APERTURA.has(current) ? 'S5' : current) as CrmStatoContatto;
}

/**
 * Testo predefinito del messaggio dell'email di partenza (N26), in plain-text.
 * Fonte unica: precompila la textarea nel modale (client) ed è la base che
 * l'admin può ritoccare ad-hoc prima dell'invio. Il resto dell'email (saluto,
 * CTA, checklist, box codice, footer) resta fisso nel template `tplN26EmailPartenza`.
 */
export function defaultMessaggioPartenza({
  categoria,
  ragioneSociale,
}: {
  categoria: 'BROKER' | 'AGENZIA';
  ragioneSociale: string;
}): string {
  const contesto =
    categoria === 'BROKER'
      ? 'Carichi la pratica in 2 minuti, un\'agenzia della tua zona la prende in carico e la segui in tempo reale.'
      : 'Ricevi pratiche già complete e verificate dalla tua provincia, e decidi tu quali accettare.';
  return `come d'accordo nella nostra telefonata, ecco il link per attivare ${ragioneSociale} su Passaggio Veloce. Bastano circa 5 minuti.\n\n${contesto}`;
}
