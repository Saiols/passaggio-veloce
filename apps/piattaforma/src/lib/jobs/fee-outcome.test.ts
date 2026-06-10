import { describe, it, expect } from 'vitest';
import { feeOutcomeFromResult } from './fee-outcome';

describe('feeOutcomeFromResult', () => {
  it('ok senza pending → SUCCESS', () => {
    expect(feeOutcomeFromResult({ ok: true, providerRef: 'pi_1' })).toEqual({
      status: 'SUCCESS', providerRef: 'pi_1',
    });
  });

  it('ok con pending → PENDING (resta IN_LAVORAZIONE)', () => {
    expect(feeOutcomeFromResult({ ok: true, providerRef: 'pi_1', pending: true })).toEqual({
      status: 'PENDING', providerRef: 'pi_1',
    });
  });

  it('fallimento retryable → RETRY', () => {
    expect(feeOutcomeFromResult({ ok: false, error: 'x', retryable: true })).toEqual({
      status: 'RETRY', error: 'x',
    });
  });

  it('fallimento non-retryable → FAILED', () => {
    expect(feeOutcomeFromResult({ ok: false, error: 'y', retryable: false })).toEqual({
      status: 'FAILED', error: 'y',
    });
  });
});
