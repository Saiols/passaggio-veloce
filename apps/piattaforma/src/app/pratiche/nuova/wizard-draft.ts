/**
 * Persistenza bozza del wizard "Nuova pratica" (localStorage). Modulo PURO:
 * gestisce l'envelope (versione + scadenza) di serializzazione, così un refresh
 * a metà compilazione non fa ripartire la pratica da zero. La sanitizzazione
 * degli slot file e il wiring React stanno nel wizard.
 */

export const DRAFT_KEY = 'pv-pratica-nuova-draft';
/**
 * Bump ad ogni cambio della forma dello stato persistito (invalida le bozze
 * vecchie, evitando crash al ripristino di una bozza con forma obsoleta).
 * v2: aggiunti veicoli.librettoRetro/fileNameRetro e identita.codiceFiscaleRetro
 *     (fronte/retro libretto + tessera sanitaria).
 * v3: aggiunti veicoli.tipoDocumento e veicoli.foglioComplementare (foglio
 *     complementare al posto del libretto).
 * v4: aggiunto coAcquirenti (co-intestatari acquirente).
 */
export const DRAFT_VERSION = 4;
/** Oltre questa età la bozza viene ignorata (e ripulita). */
export const DRAFT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 giorni

type Envelope = { version: number; savedAt: number; state: unknown };

export function serializeDraft(state: unknown, now: number): string {
  const env: Envelope = { version: DRAFT_VERSION, savedAt: now, state };
  return JSON.stringify(env);
}

/**
 * Parsa l'envelope salvato. Ritorna lo `state` solo se è JSON valido, della
 * versione corrente e non scaduto; altrimenti `null` (mai lanciare: una bozza
 * corrotta non deve impedire l'uso del wizard).
 */
export function parseDraft(json: string | null, now: number): unknown {
  if (!json) return null;
  let env: unknown;
  try {
    env = JSON.parse(json);
  } catch {
    return null;
  }
  if (!env || typeof env !== 'object') return null;
  const e = env as Partial<Envelope>;
  if (e.version !== DRAFT_VERSION) return null;
  if (typeof e.savedAt !== 'number') return null;
  if (now - e.savedAt > DRAFT_MAX_AGE_MS) return null;
  if (e.state === undefined || e.state === null) return null;
  return e.state;
}
