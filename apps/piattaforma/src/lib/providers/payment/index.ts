import 'server-only';
import { env } from '@/env';
import { MockPaymentProvider } from './mock';
import type { PaymentProvider } from './types';

export * from './types';

let instance: PaymentProvider | null = null;

export function getPayment(): PaymentProvider {
  if (instance) return instance;
  switch (env.PAYMENT_PROVIDER) {
    case 'mock':
      instance = new MockPaymentProvider();
      break;
    case 'stripe':
      throw new Error('Stripe payment provider not yet implemented');
    default:
      throw new Error(`Unknown payment provider: ${env.PAYMENT_PROVIDER}`);
  }
  return instance;
}
