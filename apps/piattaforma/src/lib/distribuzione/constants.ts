/**
 * Parametri distribuzione pratica — da `docs/piano-implementazione.md §0.5`.
 * Sostituibili via DB admin config in Fase 9.
 */
export const DISTRIBUZIONE = {
  T1_HOURS: 8, // finestra round 1 — ore lavorative dell'agenzia
  T2_HOURS: 8, // finestra round 2
  T3_HOURS: 16, // finestra round 3
  N_PER_ROUND: 5, // agenzie per round 1 e 2
  N_MAX: 15, // cap totale su round 3
} as const;

/**
 * Province limitrofe (MVP Veneto-centric) usate dal round 2 come
 * approssimazione del raggio 15 km. In produzione useremo API geo
 * o tabella comuni con coordinate.
 */
export const PROVINCE_LIMITROFE: Record<string, readonly string[]> = {
  // Veneto
  VE: ['PD', 'TV', 'RO'],
  PD: ['VE', 'TV', 'VI', 'RO'],
  TV: ['VE', 'PD', 'BL', 'VI'],
  VI: ['PD', 'TV', 'VR'],
  BL: ['TV'],
  VR: ['VI', 'MN'],
  RO: ['VE', 'PD', 'FE'],
};

export function provinceLimitrofe(provincia: string): readonly string[] {
  return PROVINCE_LIMITROFE[provincia.toUpperCase()] ?? [];
}
