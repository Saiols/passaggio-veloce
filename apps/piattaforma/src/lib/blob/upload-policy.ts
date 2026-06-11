/**
 * Policy di autorizzazione per la generazione del token di client-upload Vercel
 * Blob. Logica **pura** → testabile senza auth/Next.
 *
 * Regola: i documenti KYC di **registrazione** vengono caricati PRIMA che
 * l'account (e quindi la sessione) esista, quindi quello scope deve poter
 * generare il token anche da utente anonimo. Ogni altro scope (es. allegati
 * pratica) richiede una sessione autenticata.
 *
 * Trade-off accettato: chiunque può caricare un file (MIME/size vincolati) sotto
 * `registrazione/` senza login — è la natura di un form di registrazione
 * pubblico. Nessun dato di utenti autenticati è esposto (namespace separato).
 */

/** Prefisso pathname dei documenti caricati durante la registrazione. */
export const REGISTRATION_SCOPE = 'registrazione/';

/**
 * `true` se la generazione del token per questo pathname richiede una sessione
 * autenticata. Solo lo scope di registrazione ne è esente.
 */
export function uploadRequiresAuth(pathname: string): boolean {
  return !pathname.startsWith(REGISTRATION_SCOPE);
}
