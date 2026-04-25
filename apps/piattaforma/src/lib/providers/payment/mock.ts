import { randomUUID } from 'node:crypto';
import type {
  ChargeFeeInput,
  ExecutePayoutInput,
  PaymentProvider,
  PaymentResult,
} from './types';

const MOCK_LATENCY_MS = 200;

export class MockPaymentProvider implements PaymentProvider {
  readonly name = 'mock' as const;

  async chargeFee(input: ChargeFeeInput): Promise<PaymentResult> {
    if (input.importoCent <= 0) {
      return { ok: false, error: 'Importo non valido', retryable: false };
    }
    await sleep(MOCK_LATENCY_MS);
    console.log(
      `[MockPayment] chargeFee ${input.feeAddebitoId} importo=${input.importoCent}c agenzia=${input.agenziaId}`,
    );
    return { ok: true, providerRef: `mock-${randomUUID()}` };
  }

  async executePayout(input: ExecutePayoutInput): Promise<PaymentResult> {
    if (input.importoCent <= 0) {
      return { ok: false, error: 'Importo non valido', retryable: false };
    }
    await sleep(MOCK_LATENCY_MS);
    console.log(
      `[MockPayment] executePayout ${input.payoutId} importo=${input.importoCent}c iban=${maskIban(input.iban)}`,
    );
    return { ok: true, providerRef: `mock-${randomUUID()}` };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function maskIban(iban: string): string {
  if (iban.length < 8) return '***';
  return `${iban.slice(0, 4)}…${iban.slice(-4)}`;
}
