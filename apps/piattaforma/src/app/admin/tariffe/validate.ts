import type { TariffaRow } from '@/lib/pricing';

export type TariffaFormInput = {
  sempliceFeeEuro: number;
  sempliceCommissioneEuro: number;
  sempliceAffiliazioneEuro: number;
  minivolturaFeeEuro: number;
  minivolturaCommissioneEuro: number;
  minivolturaAffiliazioneEuro: number;
};

export type TariffaCents = TariffaRow;

function toCent(euro: number): number | null {
  if (!Number.isFinite(euro) || euro < 0) return null;
  const cent = Math.round(euro * 100);
  return Number.isSafeInteger(cent) ? cent : null;
}

export function validateTariffaInput(
  i: TariffaFormInput,
): { ok: true; cents: TariffaCents } | { ok: false; error: string } {
  const fields = {
    sempliceFeeAgenziaCent: toCent(i.sempliceFeeEuro),
    sempliceCreditoBrokerCent: toCent(i.sempliceCommissioneEuro),
    sempliceAffiliazioneCent: toCent(i.sempliceAffiliazioneEuro),
    minivolturaFeeAgenziaCent: toCent(i.minivolturaFeeEuro),
    minivolturaCreditoBrokerCent: toCent(i.minivolturaCommissioneEuro),
    minivolturaAffiliazioneCent: toCent(i.minivolturaAffiliazioneEuro),
  };
  for (const [k, v] of Object.entries(fields)) {
    if (v === null) return { ok: false, error: `Valore non valido: ${k}` };
  }
  const cents = fields as TariffaCents;
  if (cents.sempliceCreditoBrokerCent > cents.sempliceFeeAgenziaCent) {
    return { ok: false, error: 'SEMPLICE: la commissione non può superare il costo agenzia' };
  }
  if (cents.minivolturaCreditoBrokerCent > cents.minivolturaFeeAgenziaCent) {
    return { ok: false, error: 'MINIVOLTURA: la commissione non può superare il costo agenzia' };
  }
  return { ok: true, cents };
}
