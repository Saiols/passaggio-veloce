/**
 * Persistenza bozza del wizard di registrazione. Modulo PURO: gestisce solo
 * l'envelope (versione + scadenza) di serializzazione, così un refresh a metà
 * compilazione non fa ripartire la registrazione da zero. Il wiring React e la
 * scelta dello storage stanno nel wizard.
 *
 * NB: la bozza include dati sensibili (password dello step Account, PII KYC) →
 * va in **sessionStorage** (sopravvive al refresh, si azzera alla chiusura della
 * scheda), NON in localStorage. La forma è speculare a wizard-draft.ts (pratica).
 */

export const REGISTER_DRAFT_KEY = 'pv-registrazione-draft';
/** Bump ad ogni cambio della forma dello stato persistito (invalida bozze vecchie). */
export const REGISTER_DRAFT_VERSION = 1;
/** Cap di sicurezza sull'età (la sessione di norma si chiude prima). */
export const REGISTER_DRAFT_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24h

type Envelope = { version: number; savedAt: number; state: unknown };

export function serializeRegisterDraft(state: unknown, now: number): string {
  const env: Envelope = { version: REGISTER_DRAFT_VERSION, savedAt: now, state };
  return JSON.stringify(env);
}

/**
 * Parsa l'envelope salvato. Ritorna lo `state` solo se è JSON valido, della
 * versione corrente e non scaduto; altrimenti `null` (mai lanciare: una bozza
 * corrotta non deve impedire l'uso del wizard).
 */
export function parseRegisterDraft(json: string | null, now: number): unknown {
  if (!json) return null;
  let env: unknown;
  try {
    env = JSON.parse(json);
  } catch {
    return null;
  }
  if (!env || typeof env !== 'object') return null;
  const e = env as Partial<Envelope>;
  if (e.version !== REGISTER_DRAFT_VERSION) return null;
  if (typeof e.savedAt !== 'number') return null;
  if (now - e.savedAt > REGISTER_DRAFT_MAX_AGE_MS) return null;
  if (e.state === undefined || e.state === null) return null;
  return e.state;
}
