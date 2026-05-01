import { describe, it, expect } from 'vitest';
import { computeFees, type FeeBreakdown } from './pricing';

describe('computeFees', () => {
  it('passaggio privato: 75€ agenzia / 25€ broker / 50€ noi / 10€ affiliazione totale', () => {
    const result = computeFees({ tipo: 'PASSAGGIO_PRIVATO', numeroVeicoli: 1 });
    expect(result).toEqual<FeeBreakdown>({
      feeAgenziaCent: 7500,
      creditoBrokerCent: 2500,
      ricavoLordoCent: 5000,
      costoAffiliazioneTotaleCent: 1000,
    });
  });

  it('minivolture multiple N=2: 30€ agenzia / 0 broker / 30€ noi / 10€ affiliazione', () => {
    const result = computeFees({ tipo: 'MINIVOLTURE_MULTIPLE', numeroVeicoli: 2 });
    expect(result).toEqual<FeeBreakdown>({
      feeAgenziaCent: 3000,
      creditoBrokerCent: 0,
      ricavoLordoCent: 3000,
      costoAffiliazioneTotaleCent: 1000,
    });
  });

  it('minivolture multiple N=5: scala lineare', () => {
    const result = computeFees({ tipo: 'MINIVOLTURE_MULTIPLE', numeroVeicoli: 5 });
    expect(result).toEqual<FeeBreakdown>({
      feeAgenziaCent: 7500,
      creditoBrokerCent: 0,
      ricavoLordoCent: 7500,
      costoAffiliazioneTotaleCent: 2500,
    });
  });

  it('lancia errore se passaggio privato ha N != 1', () => {
    expect(() => computeFees({ tipo: 'PASSAGGIO_PRIVATO', numeroVeicoli: 2 })).toThrow(
      /numeroVeicoli deve essere 1/i,
    );
  });

  it('lancia errore se minivolture multiple ha N < 2', () => {
    expect(() => computeFees({ tipo: 'MINIVOLTURE_MULTIPLE', numeroVeicoli: 1 })).toThrow(
      /numeroVeicoli deve essere ≥ 2/i,
    );
  });
});
