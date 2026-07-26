import { z } from 'zod';
import { GIORNI_ORDINE, hhmmToMinuti, isHHMM } from '@/lib/distribuzione/calendario';

/**
 * Limiti dei parametri di distribuzione, in unità umane (km e minuti): sono
 * le stesse unità del form, così i messaggi d'errore parlano la lingua
 * dell'admin. La persistenza resta in metri e minuti (vedi `toConfigPersistita`).
 *
 * - Raggio massimo: sotto 1 km la copertura sarebbe irrealisticamente stretta
 *   (quasi ogni pratica finirebbe in "zona non coperta"); oltre 50 km si perde
 *   il senso di distribuzione locale.
 * - Passo: cap a 25 km perché un passo più largo del raggio utile renderebbe
 *   il secondo round un salto diretto al massimo.
 *
 * La durata del round ha costanti e commento dedicati, più sotto.
 */
export const RAGGIO_START_KM_MIN = 0.1;
export const RAGGIO_START_KM_MAX = 50;
export const STEP_KM_MIN = 0.1;
export const STEP_KM_MAX = 25;
export const RAGGIO_MAX_KM_MIN = 1;
export const RAGGIO_MAX_KM_MAX = 50;

/**
 * Durata del round in MINUTI: è l'unità con cui il DB già memorizza
 * `intervalloMin`, e quella in cui ragiona chi configura la piattaforma.
 *
 * Il minimo di 1 minuto è il limite del cron, che gira ogni minuto. Vercel non
 * garantisce il trigger al secondo, quindi un round da 1 minuto vale in pratica
 * 1-2 minuti: l'hint del form lo dice esplicitamente.
 */
export const DURATA_ROUND_MIN_MIN = 1;
export const DURATA_ROUND_MIN_MAX = 60;
export const STEP_DURATA_MIN_INPUT = 1;

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

const numero = (campo: string) =>
  z.number({ invalid_type_error: `Inserisci un numero valido per ${campo}` });

const orarioHHMM = z.string().refine(isHHMM, 'Usa il formato HH:MM (es. 09:00)');

/**
 * Un giorno spento non ha effetto sulla distribuzione: i suoi orari restano
 * salvati come promemoria (riattivarlo non deve costringere a ridigitarli) e
 * non vanno validati fra loro.
 *
 * `hhmmToMinuti` esplode su un orario non nel formato HH:MM: il `.refine()`
 * qui gira ANCHE quando `inizio`/`fine` hanno già fallito `orarioHHMM` sopra
 * (zod non salta gli effetti a valle di un campo invalido), quindi il
 * confronto va ri-guardato con `isHHMM` prima di convertire in minuti — quel
 * caso è già segnalato dal messaggio su `orarioHHMM`.
 */
const fasciaGiornoSchema = z
  .object({ attivo: z.boolean(), inizio: orarioHHMM, fine: orarioHHMM })
  .refine(
    (f) =>
      !f.attivo ||
      !isHHMM(f.inizio) ||
      !isHHMM(f.fine) ||
      hhmmToMinuti(f.fine) > hhmmToMinuti(f.inizio),
    {
      message: "L'orario di fine deve essere successivo a quello di inizio",
      path: ['fine'],
    },
  );

/**
 * Zero giorni attivi congelerebbe ogni pratica dopo il primo round: nessuna
 * finestra di apertura significa che il motore non allarga mai il raggio.
 */
const orariSettimanaSchema = z
  .object(Object.fromEntries(GIORNI_ORDINE.map((g) => [g, fasciaGiornoSchema])) as Record<
    (typeof GIORNI_ORDINE)[number],
    typeof fasciaGiornoSchema
  >)
  .refine((o) => Object.values(o).some((f) => f.attivo), {
    message: 'Attiva almeno un giorno: senza, nessuna pratica avanzerebbe oltre il primo round',
  });

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
    durataRoundMin: numero('la durata del round')
      .int('La durata del round va indicata in minuti interi')
      .min(DURATA_ROUND_MIN_MIN, `La durata minima di un round è ${DURATA_ROUND_MIN_MIN} min`)
      .max(DURATA_ROUND_MIN_MAX, `La durata di un round non può superare ${DURATA_ROUND_MIN_MAX} min`),
    orariSettimana: orariSettimanaSchema,
  })
  .refine((d) => d.raggioMaxKm > d.raggioStartKm, {
    message: 'Il raggio massimo deve essere maggiore del raggio iniziale',
    path: ['raggioMaxKm'],
  });

export type ConfigDistribuzioneInput = z.infer<typeof configDistribuzioneSchema>;

/**
 * km del form → metri; i minuti sono già l'unità di `intervalloMin` nel DB,
 * quindi passano invariati (nessuna conversione da fare).
 */
export function toConfigPersistita(input: ConfigDistribuzioneInput): {
  raggioStartM: number;
  stepM: number;
  raggioMaxM: number;
  intervalloMin: number;
  orariSettimana: ConfigDistribuzioneInput['orariSettimana'];
} {
  return {
    raggioStartM: Math.round(input.raggioStartKm * 1000),
    stepM: Math.round(input.stepKm * 1000),
    raggioMaxM: Math.round(input.raggioMaxKm * 1000),
    intervalloMin: input.durataRoundMin,
    orariSettimana: input.orariSettimana,
  };
}
