/**
 * I dati `regione` dei contatti CRM (import CSV) sono disomogenei: stessa regione
 * salvata in forme diverse — maiuscolo/minuscolo e trattino vs spazio
 * (es. "Veneto" / "VENETO", "Trentino-Alto Adige" / "TRENTINO ALTO ADIGE").
 * Il filtro faceva match esatto e quindi falliva.
 *
 * `regioneVarianti` genera le varianti realistiche di una regione canonica così
 * da poterle usare in un filtro `regione: { in: regioneVarianti(x) }` senza
 * dover normalizzare il dato a monte.
 */

/** Le 20 regioni italiane in forma canonica (come nei menu a tendina). */
export const REGIONI_ITALIANE = [
  'Abruzzo',
  'Basilicata',
  'Calabria',
  'Campania',
  'Emilia-Romagna',
  'Friuli-Venezia Giulia',
  'Lazio',
  'Liguria',
  'Lombardia',
  'Marche',
  'Molise',
  'Piemonte',
  'Puglia',
  'Sardegna',
  'Sicilia',
  'Toscana',
  'Trentino-Alto Adige',
  'Umbria',
  "Valle d'Aosta",
  'Veneto',
] as const;

/**
 * Varianti case/formato di una regione canonica (per match tollerante).
 * Copre: maiuscolo/minuscolo, trattino↔spazio in ogni combinazione di case.
 */
export function regioneVarianti(canonica: string): string[] {
  const base = canonica.trim();
  const forme = new Set<string>([base, base.replace(/-/g, ' '), base.replace(/\s+/g, '-')]);
  const out = new Set<string>();
  for (const f of forme) {
    out.add(f);
    out.add(f.toUpperCase());
    out.add(f.toLowerCase());
  }
  return [...out];
}
