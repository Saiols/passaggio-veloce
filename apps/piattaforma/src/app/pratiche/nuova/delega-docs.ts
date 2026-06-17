/**
 * Delega/procura a vendere (per veicolo): chiavi slot dei due allegati e
 * predicato di completezza. Modulo puro condiviso wizard (client) ↔ action
 * (server): non importa nulla di client/server-only.
 *
 * I due allegati NON passano per l'engine documentale né per il gating: sono
 * obbligatori (solo presenza) quando il broker dichiara la delega sul veicolo.
 */

export function delegatoDocKey(ordine: number): string {
  return `DELEGA_DELEGATO_${ordine}`;
}

export function procuraDelegaDocKey(ordine: number): string {
  return `DELEGA_PROCURA_${ordine}`;
}

/**
 * True se, per OGNI veicolo con `flagDelegaVendita`, entrambi gli slot
 * (delegato + procura) hanno un file "pronto". Il significato di "pronto" è
 * fornito dal chiamante: client = BlobRef caricata e non in upload; server =
 * ref presente nella mappa blobRefs. I veicoli senza delega non vincolano.
 */
export function delegaDocsComplete(
  veicoli: { flagDelegaVendita: boolean }[],
  hasReadyFile: (key: string) => boolean,
): boolean {
  return veicoli.every((v, i) => {
    if (!v.flagDelegaVendita) return true;
    const ord = i + 1;
    return (
      hasReadyFile(delegatoDocKey(ord)) && hasReadyFile(procuraDelegaDocKey(ord))
    );
  });
}
