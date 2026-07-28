/**
 * Sigla di provincia → regione, nelle forme canoniche di `lib/crm/regione.ts`.
 *
 * Serve all'arricchimento del contatto CRM: `Company` e `Sede` hanno la
 * provincia, `CrmContact` ha la regione (è il campo su cui filtra il CRM e su
 * cui si colora la mappa). Senza questa tabella il campo resterebbe vuoto per
 * ogni contatto agganciato.
 *
 * Le 107 province in vigore. Le quattro abolite dalla riforma sarda del 2016
 * (OT, OG, VS, CI) NON sono qui: non possono comparire in una registrazione
 * nuova, e un dato mancante è preferibile a uno indovinato.
 */
import { REGIONI_ITALIANE } from '@/lib/crm/regione';

type Regione = (typeof REGIONI_ITALIANE)[number];

export const PROVINCE_ITALIANE: Record<string, Regione> = {
  // Abruzzo
  AQ: 'Abruzzo', CH: 'Abruzzo', PE: 'Abruzzo', TE: 'Abruzzo',
  // Basilicata
  MT: 'Basilicata', PZ: 'Basilicata',
  // Calabria
  CS: 'Calabria', CZ: 'Calabria', KR: 'Calabria', RC: 'Calabria', VV: 'Calabria',
  // Campania
  AV: 'Campania', BN: 'Campania', CE: 'Campania', NA: 'Campania', SA: 'Campania',
  // Emilia-Romagna
  BO: 'Emilia-Romagna', FC: 'Emilia-Romagna', FE: 'Emilia-Romagna',
  MO: 'Emilia-Romagna', PC: 'Emilia-Romagna', PR: 'Emilia-Romagna',
  RA: 'Emilia-Romagna', RE: 'Emilia-Romagna', RN: 'Emilia-Romagna',
  // Friuli-Venezia Giulia
  GO: 'Friuli-Venezia Giulia', PN: 'Friuli-Venezia Giulia',
  TS: 'Friuli-Venezia Giulia', UD: 'Friuli-Venezia Giulia',
  // Lazio
  FR: 'Lazio', LT: 'Lazio', RI: 'Lazio', RM: 'Lazio', VT: 'Lazio',
  // Liguria
  GE: 'Liguria', IM: 'Liguria', SP: 'Liguria', SV: 'Liguria',
  // Lombardia
  BG: 'Lombardia', BS: 'Lombardia', CO: 'Lombardia', CR: 'Lombardia',
  LC: 'Lombardia', LO: 'Lombardia', MB: 'Lombardia', MI: 'Lombardia',
  MN: 'Lombardia', PV: 'Lombardia', SO: 'Lombardia', VA: 'Lombardia',
  // Marche
  AN: 'Marche', AP: 'Marche', FM: 'Marche', MC: 'Marche', PU: 'Marche',
  // Molise
  CB: 'Molise', IS: 'Molise',
  // Piemonte
  AL: 'Piemonte', AT: 'Piemonte', BI: 'Piemonte', CN: 'Piemonte',
  NO: 'Piemonte', TO: 'Piemonte', VB: 'Piemonte', VC: 'Piemonte',
  // Puglia
  BA: 'Puglia', BR: 'Puglia', BT: 'Puglia', FG: 'Puglia', LE: 'Puglia', TA: 'Puglia',
  // Sardegna
  CA: 'Sardegna', NU: 'Sardegna', OR: 'Sardegna', SS: 'Sardegna', SU: 'Sardegna',
  // Sicilia
  AG: 'Sicilia', CL: 'Sicilia', CT: 'Sicilia', EN: 'Sicilia', ME: 'Sicilia',
  PA: 'Sicilia', RG: 'Sicilia', SR: 'Sicilia', TP: 'Sicilia',
  // Toscana
  AR: 'Toscana', FI: 'Toscana', GR: 'Toscana', LI: 'Toscana', LU: 'Toscana',
  MS: 'Toscana', PI: 'Toscana', PO: 'Toscana', PT: 'Toscana', SI: 'Toscana',
  // Trentino-Alto Adige
  BZ: 'Trentino-Alto Adige', TN: 'Trentino-Alto Adige',
  // Umbria
  PG: 'Umbria', TR: 'Umbria',
  // Valle d'Aosta
  AO: "Valle d'Aosta",
  // Veneto
  BL: 'Veneto', PD: 'Veneto', RO: 'Veneto', TV: 'Veneto',
  VE: 'Veneto', VI: 'Veneto', VR: 'Veneto',
};

export function regioneDaProvincia(
  sigla: string | null | undefined,
): string | null {
  if (!sigla) return null;
  return PROVINCE_ITALIANE[sigla.trim().toUpperCase()] ?? null;
}
