import { describe, it, expect } from 'vitest';
import { computeFees } from './pricing';

describe('computeFees', () => {
  it('SEMPLICE singolo (1 veicolo): 75/25/50/10', () => {
    expect(computeFees({ tipo: 'SEMPLICE', numeroVeicoli: 1 })).toEqual({
      feeAgenziaCent: 7500, creditoBrokerCent: 2500, ricavoLordoCent: 5000, costoAffiliazioneTotaleCent: 1000,
    });
  });
  it('SEMPLICE multiplo (3 veicoli): scala ×3', () => {
    expect(computeFees({ tipo: 'SEMPLICE', numeroVeicoli: 3 })).toEqual({
      feeAgenziaCent: 22500, creditoBrokerCent: 7500, ricavoLordoCent: 15000, costoAffiliazioneTotaleCent: 3000,
    });
  });
  it('MINIVOLTURA singola (1 veicolo): 15/0/15/5', () => {
    expect(computeFees({ tipo: 'MINIVOLTURA', numeroVeicoli: 1 })).toEqual({
      feeAgenziaCent: 1500, creditoBrokerCent: 0, ricavoLordoCent: 1500, costoAffiliazioneTotaleCent: 500,
    });
  });
  it('MINIVOLTURA multipla (4 veicoli): scala ×4', () => {
    expect(computeFees({ tipo: 'MINIVOLTURA', numeroVeicoli: 4 })).toEqual({
      feeAgenziaCent: 6000, creditoBrokerCent: 0, ricavoLordoCent: 6000, costoAffiliazioneTotaleCent: 2000,
    });
  });
  it('lancia se numeroVeicoli < 1', () => {
    expect(() => computeFees({ tipo: 'SEMPLICE', numeroVeicoli: 0 })).toThrow();
  });
});
