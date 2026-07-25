import { z } from 'zod';

/**
 * Limiti dei parametri di distribuzione, in unità umane (km e ore): sono le
 * stesse unità del form, così i messaggi d'errore parlano la lingua dell'admin.
 * La persistenza resta in metri e minuti (vedi `toConfigPersistita`).
 *
 * - Raggio massimo: sotto 1 km la copertura sarebbe irrealisticamente stretta
 *   (quasi ogni pratica finirebbe in "zona non coperta"); oltre 50 km si perde
 *   il senso di distribuzione locale.
 * - Durata round: il cron gira ogni 10 minuti, quindi sotto i 15 minuti la
 *   durata configurata non sarebbe comunque rispettabile.
 * - Passo: cap a 25 km perché un passo più largo del raggio utile renderebbe
 *   il secondo round un salto diretto al massimo.
 */
export const RAGGIO_START_KM_MIN = 0.1;
export const RAGGIO_START_KM_MAX = 50;
export const STEP_KM_MIN = 0.1;
export const STEP_KM_MAX = 25;
export const RAGGIO_MAX_KM_MIN = 1;
export const RAGGIO_MAX_KM_MAX = 50;
export const DURATA_ROUND_ORE_MIN = 0.25;
export const DURATA_ROUND_ORE_MAX = 24;

/**
 * Passo delle frecce di `<input type="number">`.
 *
 * ⚠️ Il browser considera validi SOLO i valori `min + n·step`: un passo che non
 * divide esattamente la distanza fra `min` e i valori ammessi marca l'input
 * come `aria-invalid` anche quando il valore è perfettamente legittimo (è
 * successo con `min=0,1` e `step=0,5`, che rendeva "1 km" invalido). Tenere
 * `step` uguale al minimo — o suo sottomultiplo — mantiene tutta la griglia
 * raggiungibile. Blindato da `validate.test.ts`.
 */
export const STEP_KM_INPUT = 0.1;
export const STEP_RAGGIO_MAX_KM_INPUT = 1;
export const STEP_ORE_INPUT = 0.25;

const numero = (campo: string) =>
  z.number({ invalid_type_error: `Inserisci un numero valido per ${campo}` });

/**
 * Validazione di `salvaConfigDistribuzione`.
 *
 * Cross-field OBBLIGATORIA: il raggio massimo deve essere strettamente maggiore
 * del raggio iniziale. Se non lo fosse, `prossimoAnello` tratterebbe ogni
 * pratica come già oltre il massimo appena il primo anello risulta vuoto →
 * "zona non coperta" a raffica.
 *
 * A differenza della versione precedente, il raggio iniziale è un campo del
 * form: i due valori arrivano insieme e vengono confrontati fra loro, senza
 * mescolare un valore inviato dal client con uno letto dal DB.
 */
export const configDistribuzioneSchema = z
  .object({
    raggioStartKm: numero('il raggio iniziale')
      .min(RAGGIO_START_KM_MIN, `Il raggio iniziale minimo è ${RAGGIO_START_KM_MIN} km`)
      .max(RAGGIO_START_KM_MAX, `Il raggio iniziale non può superare ${RAGGIO_START_KM_MAX} km`),
    stepKm: numero('il passo')
      .min(STEP_KM_MIN, `Il passo minimo è ${STEP_KM_MIN} km`)
      .max(STEP_KM_MAX, `Il passo non può superare ${STEP_KM_MAX} km`),
    raggioMaxKm: numero('il raggio massimo')
      .min(RAGGIO_MAX_KM_MIN, `Il raggio massimo minimo è ${RAGGIO_MAX_KM_MIN} km`)
      .max(RAGGIO_MAX_KM_MAX, `Il raggio massimo non può superare ${RAGGIO_MAX_KM_MAX} km`),
    durataRoundOre: numero('la durata del round')
      .min(DURATA_ROUND_ORE_MIN, `La durata minima di un round è ${DURATA_ROUND_ORE_MIN} h (15 min)`)
      .max(DURATA_ROUND_ORE_MAX, `La durata di un round non può superare ${DURATA_ROUND_ORE_MAX} h`),
  })
  .refine((d) => d.raggioMaxKm > d.raggioStartKm, {
    message: 'Il raggio massimo deve essere maggiore del raggio iniziale',
    path: ['raggioMaxKm'],
  });

export type ConfigDistribuzioneInput = z.infer<typeof configDistribuzioneSchema>;

/** km/ore del form → metri/minuti, le unità con cui il motore lavora. */
export function toConfigPersistita(input: ConfigDistribuzioneInput): {
  raggioStartM: number;
  stepM: number;
  raggioMaxM: number;
  intervalloMin: number;
} {
  return {
    raggioStartM: Math.round(input.raggioStartKm * 1000),
    stepM: Math.round(input.stepKm * 1000),
    raggioMaxM: Math.round(input.raggioMaxKm * 1000),
    intervalloMin: Math.round(input.durataRoundOre * 60),
  };
}
