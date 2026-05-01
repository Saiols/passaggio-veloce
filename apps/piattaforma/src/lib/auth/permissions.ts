/**
 * Helper RBAC. Decisione D-02 (soci 2026-05-01):
 *
 * | Capability                                  | ADMIN_PIATTAFORMA | ASSISTENTE |
 * |---------------------------------------------|:------------------:|:----------:|
 * | Pratiche, anagrafiche, fee per pratica      |         ✅         |     ✅     |
 * | Wallet broker/agenzia (saldi)               |         ✅         |     ✅     |
 * | Catalogo contatti (F-05)                    |         ✅         |     ✅     |
 * | Lista escalation + assegnazione manuale     |         ✅         |     ✅     |
 * | Sospensione account                         |         ✅         |     ✅     |
 * | Dashboard finanziaria aggregata (income, KPI grafici) |   ✅       |     ❌     |
 *
 * L'ASSISTENTE è un ruolo "operativo": fa tutto sulle pratiche e i clienti,
 * ma non vede le metriche aggregate finanziarie (riservate al CEO / chi gestisce
 * il business).
 */

export type Role =
  | 'ADMIN_AZIENDA'
  | 'UTENTE_AZIENDA'
  | 'ADMIN_PIATTAFORMA'
  | 'ASSISTENTE';

export function isAdminOrAssistente(role: string | undefined): boolean {
  return role === 'ADMIN_PIATTAFORMA' || role === 'ASSISTENTE';
}

export function isAdminPiattaforma(role: string | undefined): boolean {
  return role === 'ADMIN_PIATTAFORMA';
}

/** Solo ADMIN_PIATTAFORMA vede i dati finanziari aggregati. */
export function canViewAggregatedFinancials(role: string | undefined): boolean {
  return role === 'ADMIN_PIATTAFORMA';
}
