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
  } catch (e) {
    // Il messaggio della libreria distingue cause opposte: segreto vuoto o
    // base64 rotto (misconfigurazione), timestamp troppo vecchio (replay o
    // clock disallineato), firma non corrispondente (payload non autentico).
    // Senza questo log collassano tutte in `null`, e un `whsec_` sbagliato in
    // produzione diventa indistinguibile da un attacco. Si logga SOLO il
    // messaggio della libreria — mai body, header o segreto — così nessun
    // dato controllato dall'attaccante finisce nei log.
    console.warn(
      '[resend-webhook] firma rifiutata:',
      e instanceof Error ? e.message : 'errore sconosciuto',
    );
    return null;
  }
}
