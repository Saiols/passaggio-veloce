import { z } from 'zod';

// Rifiuta stringhe vuote/whitespace PRIMA della coercizione: senza questo,
// `z.coerce.number()` legge Number('') === 0, un valore valido e in range
// (0,0 "null island"), trasformando un campo di fatto vuoto in una coordinata
// accettata. Il preprocess mappa la stringa vuota/blank a `undefined`, che
// coerce.number() converte in NaN → Number.isFinite fallisce → rejected
// (stesso esito di una chiave del tutto mancante).
const coordField = (min: number, max: number) =>
  z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
    z.coerce
      .number()
      .refine((n) => Number.isFinite(n) && n >= min && n <= max, 'coordinata non valida'),
  );

/**
 * Schema delle coordinate del luogo di consegna (lat/lng), usato dalla
 * distribuzione a raggio. Vive qui e NON in `actions.ts` perché quel file è
 * `'use server'`: un modulo 'use server' può esportare SOLO funzioni async
 * (Next.js lo impone in build di produzione — esportare un oggetto/schema da lì
 * fa crashare la pagina con "A 'use server' file can only export async
 * functions, found object").
 */
export const praticaCoordsSchema = z.object({
  lat: coordField(-90, 90),
  lng: coordField(-180, 180),
});
