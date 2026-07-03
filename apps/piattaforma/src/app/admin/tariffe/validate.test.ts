import { describe, it, expect } from 'vitest';
import { validateTariffaInput } from './validate';

const base = {
  sempliceFeeEuro: 75, sempliceCommissioneEuro: 25, sempliceAffiliazioneEuro: 10,
  minivolturaFeeEuro: 15, minivolturaCommissioneEuro: 0, minivolturaAffiliazioneEuro: 5,
};

describe('validateTariffaInput', () => {
  it('converte euro→cent', () => {
    const r = validateTariffaInput(base);
    expect(r).toEqual({
      ok: true,
      cents: {
        sempliceFeeAgenziaCent: 7500, sempliceCreditoBrokerCent: 2500, sempliceAffiliazioneCent: 1000,
        minivolturaFeeAgenziaCent: 1500, minivolturaCreditoBrokerCent: 0, minivolturaAffiliazioneCent: 500,
      },
    });
  });
  it('rifiuta commissione > costo (lordo negativo)', () => {
    const r = validateTariffaInput({ ...base, sempliceCommissioneEuro: 100 });
    expect(r.ok).toBe(false);
  });
  it('rifiuta valori negativi', () => {
    const r = validateTariffaInput({ ...base, minivolturaFeeEuro: -1 });
    expect(r.ok).toBe(false);
  });
  it('rifiuta valori non finiti', () => {
    const r = validateTariffaInput({ ...base, sempliceFeeEuro: NaN });
    expect(r.ok).toBe(false);
  });
});
