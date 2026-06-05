import 'server-only';
import { env } from '@/env';

/** True solo quando è configurato un provider di pagamento reale (es. Stripe).
 * Con `mock` i job NON devono eseguire movimenti per non muovere soldi finti. */
export function isPaymentLive(): boolean {
  return env.PAYMENT_PROVIDER !== 'mock';
}
