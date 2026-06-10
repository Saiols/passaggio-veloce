import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('getStripe', () => {
  beforeEach(() => vi.resetModules());

  it('lancia se STRIPE_SECRET_KEY manca', async () => {
    vi.doMock('@/env', () => ({ env: { STRIPE_SECRET_KEY: undefined } }));
    const { getStripe } = await import('./stripe-client');
    expect(() => getStripe()).toThrow(/STRIPE_SECRET_KEY/);
  });

  it('ritorna un client Stripe quando la chiave è presente', async () => {
    vi.doMock('@/env', () => ({ env: { STRIPE_SECRET_KEY: 'sk_test_fake' } }));
    const { getStripe } = await import('./stripe-client');
    const s = getStripe();
    expect(s.customers).toBeTruthy();
    expect(s.paymentIntents).toBeTruthy();
  });
});
