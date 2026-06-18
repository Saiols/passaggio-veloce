/**
 * Composizione di un indirizzo (parti Google Places) in una singola stringa
 * leggibile per il dettaglio pratica. Modulo puro (nessun import client/server).
 * `IndirizzoParti` è strutturalmente compatibile con `AddressParts` del
 * componente AddressAutocomplete.
 */
export type IndirizzoParti = {
  indirizzo: string;
  civico: string;
  citta: string;
  cap: string;
  provincia: string;
};

export function formatIndirizzo(p: IndirizzoParti): string {
  const via = [p.indirizzo, p.civico].filter(Boolean).join(' ').trim();
  const localita = [p.cap, p.citta].filter(Boolean).join(' ').trim();
  const prov = p.provincia ? `(${p.provincia})` : '';
  const localitaProv = [localita, prov].filter(Boolean).join(' ').trim();
  return [via, localitaProv].filter(Boolean).join(', ').trim();
}
