const STATI_PRE_INVIO = new Set(['S0', 'S1', 'S2', 'S3']);
const STATI_PRE_APERTURA = new Set(['S0', 'S1', 'S2', 'S3', 'S4']);

/** Avanza lo stato a S4 (link inviato) solo se non è un declassamento. */
export function nextStatoInvio(current: string): string {
  return STATI_PRE_INVIO.has(current) ? 'S4' : current;
}

/** Avanza lo stato a S5 (link aperto) solo se non è un declassamento. */
export function nextStatoApertura(current: string): string {
  return STATI_PRE_APERTURA.has(current) ? 'S5' : current;
}
