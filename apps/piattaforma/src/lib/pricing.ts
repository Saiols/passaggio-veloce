// Engine economico Passaggio Veloce — modello §1 feedback demo 2026-04-29.
//
// PASSAGGIO_PRIVATO (singolo, privato → privato):
//   detrazione agenzia 75 €, credito broker 25 €, nostro lordo 50 €,
//   costo affiliazione totale 10 € (a nostro carico, mai aggiunto al prezzo agenzia).
//
// MINIVOLTURE_MULTIPLE (commercianti, N veicoli ≥ 2):
//   detrazione agenzia 15 € × N, credito broker 0, nostro lordo 15 € × N,
//   costo affiliazione totale 5 € × N.

export type PraticaTipoEconomico = 'PASSAGGIO_PRIVATO' | 'MINIVOLTURE_MULTIPLE';

export type FeeBreakdown = {
  feeAgenziaCent: number;
  creditoBrokerCent: number;
  ricavoLordoCent: number;
  costoAffiliazioneTotaleCent: number;
};

export function computeFees(input: {
  tipo: PraticaTipoEconomico;
  numeroVeicoli: number;
}): FeeBreakdown {
  const { tipo, numeroVeicoli } = input;
  if (tipo === 'PASSAGGIO_PRIVATO') {
    if (numeroVeicoli !== 1) {
      throw new Error(
        `PASSAGGIO_PRIVATO: numeroVeicoli deve essere 1, ricevuto ${numeroVeicoli}`,
      );
    }
    return {
      feeAgenziaCent: 7500,
      creditoBrokerCent: 2500,
      ricavoLordoCent: 5000,
      costoAffiliazioneTotaleCent: 1000,
    };
  }
  if (tipo === 'MINIVOLTURE_MULTIPLE') {
    if (numeroVeicoli < 2) {
      throw new Error(
        `MINIVOLTURE_MULTIPLE: numeroVeicoli deve essere ≥ 2, ricevuto ${numeroVeicoli}`,
      );
    }
    return {
      feeAgenziaCent: 1500 * numeroVeicoli,
      creditoBrokerCent: 0,
      ricavoLordoCent: 1500 * numeroVeicoli,
      costoAffiliazioneTotaleCent: 500 * numeroVeicoli,
    };
  }
  const _exhaustive: never = tipo;
  throw new Error(`tipo non supportato: ${_exhaustive}`);
}
