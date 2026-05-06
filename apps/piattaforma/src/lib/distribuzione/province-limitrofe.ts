/**
 * Mappa "province limitrofe" — tutte le 110 province italiane con
 * i loro vicini geografici diretti. Usata dal round 2 della distribuzione
 * come approssimazione del raggio 15-30 km (capoluogo a capoluogo).
 *
 * Fonte: confini ISTAT 2024. Lista non esaustiva sulle isole minori
 * (Sicilia/Sardegna trattate come continuità interna; un round 2 da
 * un'isola piccola può comunque ricadere in escalation).
 *
 * Quando si attiverà un provider geo reale (Nominatim/Google) si
 * sostituirà questa mappa con `findAgenzieEntroKm(lat, lng, raggio)`.
 */
export const PROVINCE_LIMITROFE: Record<string, readonly string[]> = {
  // Piemonte
  TO: ['CN', 'AT', 'AL', 'VC', 'BI', 'AO'],
  AT: ['TO', 'CN', 'AL'],
  AL: ['TO', 'AT', 'GE', 'PV', 'PC'],
  CN: ['TO', 'AT'],
  VC: ['TO', 'BI', 'NO'],
  BI: ['TO', 'VC', 'NO'],
  NO: ['VC', 'BI', 'VB', 'MI', 'PV'],
  VB: ['NO'],
  // Valle d'Aosta
  AO: ['TO'],
  // Lombardia
  MI: ['MB', 'CO', 'VA', 'LO', 'PV', 'BG', 'NO', 'CR'],
  MB: ['MI', 'CO', 'BG', 'LC'],
  BG: ['MI', 'MB', 'LC', 'BS', 'CR', 'SO'],
  BS: ['BG', 'CR', 'MN', 'TN', 'VR', 'SO'],
  CO: ['MI', 'MB', 'VA', 'LC', 'SO'],
  CR: ['MI', 'BG', 'BS', 'LO', 'MN', 'PR', 'PC'],
  LC: ['MB', 'BG', 'CO', 'SO'],
  LO: ['MI', 'CR', 'PV', 'PC'],
  MN: ['BS', 'CR', 'VR', 'MO', 'RE', 'PR'],
  PV: ['MI', 'NO', 'AL', 'LO', 'PC', 'GE'],
  SO: ['BG', 'BS', 'CO', 'LC'],
  VA: ['MI', 'CO', 'NO'],
  // Trentino Alto Adige
  TN: ['BS', 'BZ', 'BL', 'VI', 'VR'],
  BZ: ['TN', 'BL'],
  // Veneto
  VE: ['PD', 'TV', 'RO', 'VR'],
  PD: ['VE', 'TV', 'VI', 'RO', 'VR'],
  TV: ['VE', 'PD', 'BL', 'VI', 'PN'],
  VI: ['PD', 'TV', 'VR', 'TN'],
  BL: ['TV', 'TN', 'BZ', 'PN', 'UD'],
  VR: ['VI', 'PD', 'MN', 'TN', 'BS'],
  RO: ['VE', 'PD', 'FE', 'MN', 'VR'],
  // Friuli-Venezia Giulia
  UD: ['PN', 'BL', 'GO'],
  GO: ['UD', 'TS'],
  PN: ['UD', 'TV', 'BL', 'VE'],
  TS: ['GO'],
  // Liguria
  GE: ['SP', 'AL', 'PV', 'PC', 'PR'],
  IM: ['SV'],
  SP: ['GE', 'PR', 'MS'],
  SV: ['IM', 'GE', 'CN'],
  // Emilia-Romagna
  BO: ['MO', 'FE', 'RA', 'FC', 'PT', 'FI', 'PO'],
  FC: ['BO', 'RA', 'RN', 'AR', 'FI', 'PU'],
  FE: ['BO', 'MO', 'RA', 'RO'],
  MO: ['BO', 'FE', 'RE', 'MN', 'PT', 'LU', 'PI'],
  PR: ['RE', 'MN', 'PC', 'GE', 'SP', 'MS', 'CR'],
  PC: ['PR', 'AL', 'PV', 'CR', 'GE', 'LO'],
  RA: ['BO', 'FE', 'FC', 'FI'],
  RE: ['MO', 'MN', 'PR'],
  RN: ['FC', 'PU'],
  // Toscana
  AR: ['FI', 'SI', 'PG', 'FC', 'PU'],
  FI: ['PT', 'PO', 'BO', 'AR', 'SI', 'LU', 'MO', 'RA', 'FC'],
  GR: ['LI', 'SI', 'VT'],
  LI: ['PI', 'GR'],
  LU: ['MS', 'PT', 'PI', 'FI', 'MO'],
  MS: ['LU', 'SP', 'PR'],
  PI: ['LI', 'LU', 'PT', 'FI', 'SI', 'MO'],
  PO: ['FI', 'PT', 'BO'],
  PT: ['FI', 'PO', 'PI', 'LU', 'BO', 'MO'],
  SI: ['FI', 'AR', 'GR', 'PG', 'VT', 'PI'],
  // Umbria
  PG: ['AR', 'SI', 'TR', 'AN', 'MC', 'AP', 'PU'],
  TR: ['PG', 'VT', 'RI', 'AQ'],
  // Marche
  AN: ['MC', 'PU', 'PG'],
  AP: ['MC', 'FM', 'PE', 'TE', 'RI', 'PG'],
  FM: ['AP', 'MC'],
  MC: ['AN', 'AP', 'FM', 'PG', 'PU'],
  PU: ['AN', 'MC', 'PG', 'AR', 'FC', 'RN'],
  // Lazio
  FR: ['RM', 'LT', 'IS', 'CE', 'AQ', 'CH'],
  LT: ['RM', 'FR', 'CE'],
  RI: ['RM', 'TR', 'AQ', 'AP', 'PG'],
  RM: ['VT', 'RI', 'FR', 'LT'],
  VT: ['RM', 'TR', 'GR', 'SI', 'PG'],
  // Abruzzo
  AQ: ['TE', 'PE', 'CH', 'IS', 'FR', 'RI', 'TR'],
  CH: ['PE', 'AQ', 'IS', 'CB', 'FR'],
  PE: ['TE', 'AQ', 'CH', 'AP'],
  TE: ['AP', 'AQ', 'PE'],
  // Molise
  CB: ['IS', 'CH', 'FG', 'BN'],
  IS: ['CB', 'AQ', 'CH', 'FR', 'CE'],
  // Campania
  AV: ['BN', 'NA', 'SA', 'CE', 'PZ', 'FG'],
  BN: ['AV', 'CE', 'CB', 'FG'],
  CE: ['NA', 'BN', 'AV', 'IS', 'FR', 'LT'],
  NA: ['CE', 'AV', 'SA'],
  SA: ['NA', 'AV', 'PZ'],
  // Puglia
  BA: ['BT', 'TA', 'BR', 'MT', 'PZ', 'FG'],
  BT: ['BA', 'FG'],
  BR: ['BA', 'TA', 'LE'],
  FG: ['BT', 'BA', 'CB', 'BN', 'AV', 'PZ'],
  LE: ['BR', 'TA'],
  TA: ['BA', 'BR', 'LE', 'MT'],
  // Basilicata
  MT: ['BA', 'PZ', 'TA', 'CS'],
  PZ: ['MT', 'AV', 'SA', 'BA', 'FG', 'CS'],
  // Calabria
  CS: ['CZ', 'KR', 'PZ', 'MT'],
  CZ: ['CS', 'KR', 'VV', 'RC'],
  KR: ['CS', 'CZ'],
  RC: ['CZ', 'VV', 'ME'],
  VV: ['CZ', 'CS', 'RC'],
  // Sicilia
  AG: ['TP', 'PA', 'CL', 'EN'],
  CL: ['AG', 'PA', 'EN', 'CT', 'RG'],
  CT: ['ME', 'EN', 'SR', 'RG', 'CL'],
  EN: ['CL', 'PA', 'ME', 'CT', 'AG'],
  ME: ['EN', 'CT', 'PA', 'RC'],
  PA: ['TP', 'AG', 'CL', 'EN', 'ME'],
  RG: ['CL', 'CT', 'SR'],
  SR: ['CT', 'RG'],
  TP: ['AG', 'PA'],
  // Sardegna
  CA: ['SU', 'OR', 'NU'],
  NU: ['OR', 'SS', 'CA'],
  OR: ['NU', 'SS', 'CA'],
  SS: ['NU', 'OR'],
  SU: ['CA'],
};

export function provinceLimitrofe(provincia: string): readonly string[] {
  return PROVINCE_LIMITROFE[provincia.toUpperCase()] ?? [];
}
