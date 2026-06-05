// Engine economico Passaggio Veloce. Fee PER VEICOLO × numeroVeicoli.
// SEMPLICE (acquirente privato): agenzia 75€, broker 25€, lordo 50€, affiliazione 10€ — per veicolo.
// MINIVOLTURA (acquirente commerciante): agenzia 15€, broker 0, lordo 15€, affiliazione 5€ — per veicolo.

export type PraticaTipoEconomico = 'SEMPLICE' | 'MINIVOLTURA';

export type FeeBreakdown = {
  feeAgenziaCent: number;
  creditoBrokerCent: number;
  ricavoLordoCent: number;
  costoAffiliazioneTotaleCent: number;
};

const PER_VEICOLO: Record<PraticaTipoEconomico, FeeBreakdown> = {
  SEMPLICE: { feeAgenziaCent: 7500, creditoBrokerCent: 2500, ricavoLordoCent: 5000, costoAffiliazioneTotaleCent: 1000 },
  MINIVOLTURA: { feeAgenziaCent: 1500, creditoBrokerCent: 0, ricavoLordoCent: 1500, costoAffiliazioneTotaleCent: 500 },
};

export function computeFees(input: { tipo: PraticaTipoEconomico; numeroVeicoli: number }): FeeBreakdown {
  const { tipo, numeroVeicoli } = input;
  if (!Number.isInteger(numeroVeicoli) || numeroVeicoli < 1) {
    throw new Error(`numeroVeicoli deve essere un intero >= 1, ricevuto ${numeroVeicoli}`);
  }
  const u = PER_VEICOLO[tipo];
  if (!u) throw new Error(`tipo non supportato: ${tipo}`);
  return {
    feeAgenziaCent: u.feeAgenziaCent * numeroVeicoli,
    creditoBrokerCent: u.creditoBrokerCent * numeroVeicoli,
    ricavoLordoCent: u.ricavoLordoCent * numeroVeicoli,
    costoAffiliazioneTotaleCent: u.costoAffiliazioneTotaleCent * numeroVeicoli,
  };
}
