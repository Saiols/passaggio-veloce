import { z } from 'zod';

/**
 * Limiti ragionevoli per `raggioMaxM` (metri). Sotto i 1000m la copertura
 * sarebbe irrealisticamente stretta (quasi ogni pratica finirebbe in "zona
 * non coperta"); oltre i 50000m si perde il senso di "distribuzione locale"
 * del paper Alberto.
 */
export const RAGGIO_MAX_MIN = 1000;
export const RAGGIO_MAX_MAX = 50000;

export type ConfigDistribuzioneFormInput = {
  raggioMaxM: number;
  raggioStartM: number;
};

/**
 * Validazione di `salvaConfigDistribuzione` (Task 10).
 *
 * Cross-field OBBLIGATORIA: `raggioMaxM` deve essere strettamente maggiore di
 * `raggioStartM`. Se non lo fosse, il motore anelli (`prossimoAnello`, Task 3)
 * tratterebbe ogni pratica come già oltre il raggio massimo al primo tick →
 * "zona non coperta" immediata per tutte le pratiche nuove.
 *
 * `raggioStartM` non è un campo editabile da questo form: arriva dal valore
 * corrente in DB (letto server-side in actions.ts), mai da un input utente —
 * altrimenti un client con uno stato stantio potrebbe far passare una
 * combinazione incoerente.
 */
export const configDistribuzioneSchema = z
  .object({
    raggioMaxM: z
      .number({ invalid_type_error: 'Inserisci un numero valido' })
      .int('Deve essere un numero intero di metri')
      .min(RAGGIO_MAX_MIN, `Il raggio massimo minimo è ${RAGGIO_MAX_MIN} m`)
      .max(RAGGIO_MAX_MAX, `Il raggio massimo non può superare ${RAGGIO_MAX_MAX} m`),
    raggioStartM: z.number().int().positive(),
  })
  .refine((d) => d.raggioMaxM > d.raggioStartM, {
    message: 'Il raggio massimo deve essere maggiore del raggio iniziale',
    path: ['raggioMaxM'],
  });
