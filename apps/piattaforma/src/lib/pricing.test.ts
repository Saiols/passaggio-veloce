import { describe, it, expect } from 'vitest';
import { computeFees, rowToTariffario, margineLordoCent, DEFAULT_TARIFFARIO } from './pricing';

describe('computeFees (tariffario esplicito)', () => {
  it('SEMPLICE 1 veicolo coi default: 75/25/50/10', () => {
    expect(computeFees({ tipo: 'SEMPLICE', numeroVeicoli: 1 }, DEFAULT_TARIFFARIO)).toEqual({
      feeAgenziaCent: 7500, creditoBrokerCent: 2500, ricavoLordoCent: 5000, costoAffiliazioneTotaleCent: 1000,
    });
  });
  it('SEMPLICE 3 veicoli: scala ×3', () => {
    expect(computeFees({ tipo: 'SEMPLICE', numeroVeicoli: 3 }, DEFAULT_TARIFFARIO)).toEqual({
      feeAgenziaCent: 22500, creditoBrokerCent: 7500, ricavoLordoCent: 15000, costoAffiliazioneTotaleCent: 3000,
    });
  });
  it('MINIVOLTURA 1 veicolo coi default: 15/0/15/5', () => {
    expect(computeFees({ tipo: 'MINIVOLTURA', numeroVeicoli: 1 }, DEFAULT_TARIFFARIO)).toEqual({
      feeAgenziaCent: 1500, creditoBrokerCent: 0, ricavoLordoCent: 1500, costoAffiliazioneTotaleCent: 500,
    });
  });
  it('ricavo lordo derivato = fee − commissione, con tariffario custom', () => {
    const t = {
      SEMPLICE: { feeAgenziaCent: 9000, creditoBrokerCent: 3000, affiliazioneCent: 1200 },
      MINIVOLTURA: { feeAgenziaCent: 2000, creditoBrokerCent: 500, affiliazioneCent: 400 },
    };
    expect(computeFees({ tipo: 'SEMPLICE', numeroVeicoli: 2 }, t)).toEqual({
      feeAgenziaCent: 18000, creditoBrokerCent: 6000, ricavoLordoCent: 12000, costoAffiliazioneTotaleCent: 2400,
    });
  });
  it('lancia se numeroVeicoli < 1', () => {
    expect(() => computeFees({ tipo: 'SEMPLICE', numeroVeicoli: 0 }, DEFAULT_TARIFFARIO)).toThrow();
  });
});

describe('margineLordoCent (importi già persistiti sulla pratica)', () => {
  it('SEMPLICE coi default: 75 − 25 = 50', () => {
    expect(margineLordoCent({ feeAgenziaCent: 7500, creditoBrokerCent: 2500 })).toBe(5000);
  });
  it('MINIVOLTURA (nessun credito broker): il margine è tutta la fee', () => {
    expect(margineLordoCent({ feeAgenziaCent: 1500, creditoBrokerCent: 0 })).toBe(1500);
  });
  it('coincide con il ricavo lordo calcolato dal tariffario, multi-veicolo incluso', () => {
    const fees = computeFees({ tipo: 'SEMPLICE', numeroVeicoli: 3 }, DEFAULT_TARIFFARIO);
    expect(margineLordoCent(fees)).toBe(fees.ricavoLordoCent);
  });
});

describe('rowToTariffario', () => {
  it('null → DEFAULT_TARIFFARIO', () => {
    expect(rowToTariffario(null)).toEqual(DEFAULT_TARIFFARIO);
  });
  it('mappa le 6 colonne cent in Tariffario', () => {
    expect(
      rowToTariffario({
        sempliceFeeAgenziaCent: 8000, sempliceCreditoBrokerCent: 2000, sempliceAffiliazioneCent: 900,
        minivolturaFeeAgenziaCent: 1600, minivolturaCreditoBrokerCent: 100, minivolturaAffiliazioneCent: 450,
      }),
    ).toEqual({
      SEMPLICE: { feeAgenziaCent: 8000, creditoBrokerCent: 2000, affiliazioneCent: 900 },
      MINIVOLTURA: { feeAgenziaCent: 1600, creditoBrokerCent: 100, affiliazioneCent: 450 },
    });
  });
});
