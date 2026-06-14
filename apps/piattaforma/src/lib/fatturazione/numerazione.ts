/**
 * Logica pura: dato lo stato del registro {anno, num}, calcola il prossimo numero
 * per l'anno fiscale corrente. Nuovo anno → reset a 1.
 */
export function prossimoNumero(
  registro: { anno: number | null; num: number | null },
  annoCorrente: number,
): { anno: number; num: number } {
  if (registro.anno === annoCorrente && registro.num != null) {
    return { anno: annoCorrente, num: registro.num + 1 };
  }
  return { anno: annoCorrente, num: 1 };
}
