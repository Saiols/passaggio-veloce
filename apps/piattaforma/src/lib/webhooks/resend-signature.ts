import 'server-only';
import { Webhook } from 'svix';

/**
 * Verifica la firma Svix di un webhook Resend (header `svix-id`,
 * `svix-timestamp`, `svix-signature`).
 *
 * Sta in un modulo suo perché la route non deve sapere nulla di crittografia:
 * qui c'è l'unico punto in cui si decide se un payload è autentico, ed è
 * testabile in isolamento. `svix` gestisce anche la tolleranza sul timestamp,
 * quindi un replay vecchio viene rifiutato senza codice nostro.
 *
 * Ritorna il payload verificato, oppure `null` — mai un throw: il chiamante
 * deve poter rispondere 401 senza avvolgere tutto in un try.
 */
export function verificaFirmaResend(
  rawBody: string,
  headers: Record<string, string>,
  secret: string,
): unknown | null {
  try {
    return new Webhook(secret).verify(rawBody, headers);
  } catch {
    return null;
  }
}
