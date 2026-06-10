export type PaymentProviderName = 'mock' | 'stripe';

export type ChargeFeeInput = {
  feeAddebitoId: string;
  importoCent: number;
  agenziaId: string;
};

export type ExecutePayoutInput = {
  payoutId: string;
  importoCent: number;
  iban: string;
};

export type PaymentResult =
  | { ok: true; providerRef: string; pending?: boolean }
  | { ok: false; error: string; retryable: boolean };

export interface PaymentProvider {
  readonly name: PaymentProviderName;
  chargeFee(input: ChargeFeeInput): Promise<PaymentResult>;
  executePayout(input: ExecutePayoutInput): Promise<PaymentResult>;
}
