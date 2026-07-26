/**
 * FONTE UNICA del consenso cookie: chiave di storage, forma del record,
 * evento di notifica e lettura del flag analytics.
 *
 * Prima queste costanti vivevano dentro `components/cookie-banner.tsx`, unico
 * consumatore. Da quando Google Analytics si accende sul flag `analytics`, i
 * consumatori sono due e devono leggere lo stesso record: un banner che salva
 * `pv-cookie-consent-v2` e un loader che legge `-v1` non fallisce alcun test —
 * semplicemente non traccia mai nessuno, oppure traccia chi ha detto di no.
 *
 * ⚠️ VERSIONE DELLA CHIAVE. `v1` è stata raccolta quando la piattaforma non
 * aveva alcun cookie analytics: il banner diceva testualmente «Nessun cookie di
 * terze parti attualmente attivo». Un consenso prestato a quelle condizioni non
 * copre l'introduzione di Google Analytics — un titolare terzo, con
 * trasferimento negli Stati Uniti. Il consenso dev'essere informato e specifico
 * (art. 4 n. 11 GDPR), quindi la chiave è passata a `v2`: chi aveva già scelto
 * se lo vede richiedere una volta sola, con il testo aggiornato che nomina
 * Google. NON riusare `v1` e non "migrare" i vecchi valori.
 */

export const COOKIE_CONSENT_STORAGE_KEY = 'pv-cookie-consent-v2';

/**
 * Evento custom emesso dopo un salvataggio: l'evento `storage` nativo non si
 * emette nel tab che ha scritto, quindi senza questo il loader GA nella stessa
 * scheda non si accorgerebbe del consenso appena dato.
 */
export const COOKIE_CONSENT_EVENT = 'pv-cookie-consent';

export type CookieConsent = {
  /** Sempre true: sessione, login e CSRF non sono rinunciabili. */
  essenziali: true;
  analytics: boolean;
  marketing: boolean;
  /** ISO 8601, per dimostrare QUANDO il consenso è stato prestato. */
  ts: string;
};

/**
 * Legge il record dal valore grezzo di localStorage. Tollerante per scelta: un
 * JSON corrotto, troncato o di una forma precedente non deve far esplodere il
 * layout root — vale "nessun consenso", che è il default sicuro (niente
 * tracciamento e banner di nuovo a video).
 */
export function parseConsent(raw: string | null): CookieConsent | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const rec = parsed as Record<string, unknown>;
  if (typeof rec.analytics !== 'boolean' || typeof rec.marketing !== 'boolean') return null;
  return {
    essenziali: true,
    analytics: rec.analytics,
    marketing: rec.marketing,
    ts: typeof rec.ts === 'string' ? rec.ts : '',
  };
}

/**
 * Unico predicato che decide se possiamo far partire l'analytics. Fail-closed:
 * in assenza di record — primo accesso, storage svuotato, JSON illeggibile —
 * la risposta è NO.
 */
export function hasAnalyticsConsent(raw: string | null): boolean {
  return parseConsent(raw)?.analytics === true;
}

export function serializeConsent(scelte: { analytics: boolean; marketing: boolean }, ts: string): string {
  const consent: CookieConsent = {
    essenziali: true,
    analytics: scelte.analytics,
    marketing: scelte.marketing,
    ts,
  };
  return JSON.stringify(consent);
}
