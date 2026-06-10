import 'server-only';
import Stripe from 'stripe';
import { env } from '@/env';

let instance: Stripe | null = null;

/** Istanza singleton Stripe. Lancia se la chiave manca (provider=stripe senza env). */
export function getStripe(): Stripe {
  if (instance) return instance;
  if (!env.STRIPE_SECRET_KEY) {
    throw new Error('STRIPE_SECRET_KEY mancante con PAYMENT_PROVIDER=stripe');
  }
  instance = new Stripe(env.STRIPE_SECRET_KEY);
  return instance;
}
