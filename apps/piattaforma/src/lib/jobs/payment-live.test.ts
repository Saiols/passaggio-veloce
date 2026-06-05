import { describe, it, expect, vi } from 'vitest';
vi.mock('@/env', () => ({ env: { PAYMENT_PROVIDER: 'mock' } }));
import { isPaymentLive } from './payment-live';

describe('isPaymentLive', () => {
  it('false con provider mock', () => {
    expect(isPaymentLive()).toBe(false);
  });
});
