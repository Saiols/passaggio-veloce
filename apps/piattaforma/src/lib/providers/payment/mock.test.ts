import { describe, it, expect } from 'vitest';
import { MockPaymentProvider } from './mock';

describe('MockPaymentProvider', () => {
  const provider = new MockPaymentProvider();

  it('returns ok with mock-prefixed providerRef on chargeFee', async () => {
    const res = await provider.chargeFee({
      feeAddebitoId: 'fee-1',
      importoCent: 5000,
      agenziaId: 'ag-1',
      tentativo: 0,
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.providerRef).toMatch(/^mock-/);
    }
  });

  it('returns ok with mock-prefixed providerRef on executePayout', async () => {
    const res = await provider.executePayout({
      payoutId: 'payout-1',
      importoCent: 100000,
      iban: 'IT60X0542811101000000123456',
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.providerRef).toMatch(/^mock-/);
    }
  });

  it('rejects negative amounts as non-retryable error', async () => {
    const res = await provider.chargeFee({
      feeAddebitoId: 'fee-x',
      importoCent: -100,
      agenziaId: 'ag-x',
      tentativo: 0,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.retryable).toBe(false);
    }
  });

  it('exposes name = "mock"', () => {
    expect(provider.name).toBe('mock');
  });

  it('rejects zero amount on chargeFee as non-retryable error', async () => {
    const res = await provider.chargeFee({
      feeAddebitoId: 'fee-zero',
      importoCent: 0,
      agenziaId: 'ag-zero',
      tentativo: 0,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.retryable).toBe(false);
    }
  });

  it('rejects negative amount on executePayout as non-retryable error', async () => {
    const res = await provider.executePayout({
      payoutId: 'payout-x',
      importoCent: -50,
      iban: 'IT60X0542811101000000123456',
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.retryable).toBe(false);
    }
  });
});
