/**
 * Logica pura del documento di circolazione di un veicolo nel wizard pratica.
 *
 * Due tipi di documento:
 *  - LIBRETTO: libretto standard, fronte + retro + OCR combinato (come sempre).
 *  - FOGLIO_COMPLEMENTARE: un solo PDF (tipicamente quando vende un commerciante
 *    d'auto). Per ora niente OCR: i campi si inseriscono a mano (la mappatura
 *    dedicata arriverà con il documento di esempio).
 */
export type TipoDocumentoVeicolo = 'LIBRETTO' | 'FOGLIO_COMPLEMENTARE';

export type StatoDocVeicolo = {
  tipoDocumento: TipoDocumentoVeicolo;
  /** BlobRef del fronte libretto presente. */
  librettoFronte: boolean;
  /** BlobRef del retro libretto presente. */
  librettoRetro: boolean;
  /** OCR del libretto andato a buon fine. */
  ocr: boolean;
  /** BlobRef del PDF foglio complementare presente. */
  foglio: boolean;
};

/**
 * Ritorna l'etichetta del documento mancante per il gate dello step veicoli,
 * oppure `null` se il documento è completo. Non controlla i campi anagrafici
 * (targa/telaio/…): quelli restano nel gate del wizard.
 */
export function docVeicoloMancante(s: StatoDocVeicolo): string | null {
  if (s.tipoDocumento === 'FOGLIO_COMPLEMENTARE') {
    return s.foglio ? null : 'foglio complementare';
  }
  // LIBRETTO: servono entrambe le facciate + l'OCR (no compilazione manuale di
  // un libretto illeggibile).
  if (!s.librettoFronte) return 'libretto fronte';
  if (!s.librettoRetro) return 'libretto retro';
  if (!s.ocr) return 'OCR libretto non riuscito';
  return null;
}

/** True se il documento di circolazione del veicolo è completo. */
export function docVeicoloCompleto(s: StatoDocVeicolo): boolean {
  return docVeicoloMancante(s) === null;
}
