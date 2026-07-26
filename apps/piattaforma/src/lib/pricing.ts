// Engine economico Passaggio Veloce. Fee PER VEICOLO × numeroVeicoli.
// I valori NON sono più hard-coded: il tariffario arriva come parametro
// (default legacy in DEFAULT_TARIFFARIO). Il ricavo lordo è derivato.

export type PraticaTipoEconomico = 'SEMPLICE' | 'MINIVOLTURA';

export type FeeBreakdown = {
  feeAgenziaCent: number;
  creditoBrokerCent: number;
  ricavoLordoCent: number;
  costoAffiliazioneTotaleCent: number;
};

export type TariffaUnit = {
  feeAgenziaCent: number;
  creditoBrokerCent: number;
  affiliazioneCent: number;
};

export type Tariffario = Record<PraticaTipoEconomico, TariffaUnit>;

// Valori legacy (= default UI + seed + fallback quando manca la riga attiva).
export const DEFAULT_TARIFFARIO: Tariffario = {
  SEMPLICE: { feeAgenziaCent: 7500, creditoBrokerCent: 2500, affiliazioneCent: 1000 },
  MINIVOLTURA: { feeAgenziaCent: 1500, creditoBrokerCent: 0, affiliazioneCent: 500 },
};

// Shape delle 6 colonne della riga DB (evita di importare i tipi Prisma qui).
export type TariffaRow = {
  sempliceFeeAgenziaCent: number;
  sempliceCreditoBrokerCent: number;
  sempliceAffiliazioneCent: number;
  minivolturaFeeAgenziaCent: number;
  minivolturaCreditoBrokerCent: number;
  minivolturaAffiliazioneCent: number;
};

/** Mappa una riga DB (o null → DEFAULT) nel Tariffario. Puro, testabile. */
export function rowToTariffario(row: TariffaRow | null): Tariffario {
  if (!row) return DEFAULT_TARIFFARIO;
  return {
    SEMPLICE: {
      feeAgenziaCent: row.sempliceFeeAgenziaCent,
      creditoBrokerCent: row.sempliceCreditoBrokerCent,
      affiliazioneCent: row.sempliceAffiliazioneCent,
    },
    MINIVOLTURA: {
      feeAgenziaCent: row.minivolturaFeeAgenziaCent,
      creditoBrokerCent: row.minivolturaCreditoBrokerCent,
      affiliazioneCent: row.minivolturaAffiliazioneCent,
    },
  };
}

/**
 * Margine lordo della piattaforma su UNA pratica, dagli importi già persistiti
 * su di essa: l'agenzia paga `feeAgenziaCent` (FeeAddebito), al broker viene
 * accreditato `creditoBrokerCent` (wallet), a PV resta la differenza.
 *
 * Stessa formula di `computeFees().ricavoLordoCent`, ma applicabile a una riga
 * DB (dove il tariffario del momento non è più disponibile): le viste devono
 * leggerla da qui, non ricalcolarla a mano.
 */
export function margineLordoCent(p: {
  feeAgenziaCent: number;
  creditoBrokerCent: number;
}): number {
  return p.feeAgenziaCent - p.creditoBrokerCent;
}

export function computeFees(
  input: { tipo: PraticaTipoEconomico; numeroVeicoli: number },
  tariffario: Tariffario,
): FeeBreakdown {
  const { tipo, numeroVeicoli } = input;
  if (!Number.isInteger(numeroVeicoli) || numeroVeicoli < 1) {
    throw new Error(`numeroVeicoli deve essere un intero >= 1, ricevuto ${numeroVeicoli}`);
  }
  const u = tariffario[tipo];
  if (!u) throw new Error(`tipo non supportato: ${tipo}`);
  const ricavoLordoUnit = u.feeAgenziaCent - u.creditoBrokerCent;
  return {
    feeAgenziaCent: u.feeAgenziaCent * numeroVeicoli,
    creditoBrokerCent: u.creditoBrokerCent * numeroVeicoli,
    ricavoLordoCent: ricavoLordoUnit * numeroVeicoli,
    costoAffiliazioneTotaleCent: u.affiliazioneCent * numeroVeicoli,
  };
}
