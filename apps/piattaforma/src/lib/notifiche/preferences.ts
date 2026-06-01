/**
 * Preferenze notifiche: classificazione obbligatorie vs opzionali e gating.
 * Le notifiche transazionali (conferme, firme, addebiti, escalation, account)
 * sono sempre inviate. Solo le opzionali rispettano le preferenze utente.
 */

export const OPTIONAL_TIPI: ReadonlySet<string> = new Set([
  'N3_BROKER_SOLLECITO',
  'N7_AGENZIA_PROMEMORIA_COUNTDOWN',
  'N25_MONTHLY_AFFILIATION_RECAP',
  'N31_VALUTA_AGENZIA',
]);

/** Etichette UI per le notifiche opzionali (pagina preferenze). */
export const OPTIONAL_TIPI_LABELS: Record<string, string> = {
  N3_BROKER_SOLLECITO: 'Solleciti pratiche non firmate',
  N7_AGENZIA_PROMEMORIA_COUNTDOWN: 'Promemoria countdown addebito',
  N25_MONTHLY_AFFILIATION_RECAP: 'Recap mensile affiliazione',
  N31_VALUTA_AGENZIA: 'Inviti a valutare l’agenzia',
};

export function isOptionalTipo(tipo: string): boolean {
  return OPTIONAL_TIPI.has(tipo);
}

/**
 * Decide se inviare. Le obbligatorie passano sempre. Le opzionali sono
 * opt-in di default: inviate salvo `prefs[tipo] === false`.
 */
export function shouldSend(
  tipo: string,
  prefs: Record<string, boolean> | null | undefined,
): boolean {
  if (!isOptionalTipo(tipo)) return true;
  return prefs?.[tipo] !== false;
}
