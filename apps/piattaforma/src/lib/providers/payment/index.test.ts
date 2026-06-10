import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./stripe', () => ({
  StripePaymentProvider: class {
    readonly name = 'stripe' as const;
    async chargeFee() { return { ok: true as const, providerRef: 'x' }; }
    async executePayout() { return { ok: true as const, providerRef: 'y' }; }
  },
}));

describe('getPayment', () => {
  beforeEach(() => vi.resetModules());

  it('ritorna il provider stripe quando PAYMENT_PROVIDER=stripe', async () => {
    vi.doMock('@/env', () => ({ env: { PAYMENT_PROVIDER: 'stripe' } }));
    const { getPayment } = await import('./index');
    expect(getPayment().name).toBe('stripe');
  });

  it('ritorna il provider mock quando PAYMENT_PROVIDER=mock', async () => {
    vi.doMock('@/env', () => ({ env: { PAYMENT_PROVIDER: 'mock' } }));
    const { getPayment } = await import('./index');
    expect(getPayment().name).toBe('mock');
  });
});
