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
  | 'ASSISTENTE'
  // CRM team interno (release CRM-A 2026-05-06)
  | 'AD'
  | 'CTO'
  | 'CFO'
  | 'SALES_MANAGER'
  | 'SALES';

export function isAdminOrAssistente(role: string | undefined): boolean {
  return role === 'ADMIN_PIATTAFORMA' || role === 'ASSISTENTE';
}

export function isAdminPiattaforma(role: string | undefined): boolean {
  return role === 'ADMIN_PIATTAFORMA';
}

/**
 * Proprietario dell'azienda madre (multi-sede): accesso implicito a TUTTE le
 * sedi e alla vista aggregata. Mappa sul ruolo piattaforma `ADMIN_AZIENDA`.
 */
export function isOwner(role: string | undefined): boolean {
  return role === 'ADMIN_AZIENDA';
}

/** Solo ADMIN_PIATTAFORMA vede i dati finanziari aggregati piattaforma. */
export function canViewAggregatedFinancials(role: string | undefined): boolean {
  return role === 'ADMIN_PIATTAFORMA';
}

// ════════════════════════════════════════════════════════
// CRM RBAC (release CRM-A 2026-05-06)
// Spec autoritativa: docs/crm-spec-implementativa.md §3.
// `ADMIN_PIATTAFORMA` mappa con `admin` del prototipo Alberto.
// `ASSISTENTE` non ha accesso al CRM (decisione 3).
// ════════════════════════════════════════════════════════

const CRM_FULL = ['ADMIN_PIATTAFORMA', 'AD', 'CTO'] as const;
const CRM_FULL_PLUS_SM = [...CRM_FULL, 'SALES_MANAGER'] as const;
const CRM_FULL_PLUS_SALES = [...CRM_FULL_PLUS_SM, 'SALES'] as const;

function inSet<T extends readonly string[]>(set: T, role: string | undefined): boolean {
  return !!role && (set as readonly string[]).includes(role);
}

export function canViewCrm(role: string | undefined): boolean {
  return inSet(CRM_FULL_PLUS_SALES, role);
}

export function canEditCrmContact(role: string | undefined): boolean {
  return inSet(CRM_FULL_PLUS_SALES, role);
}

export function canDeleteCrmContact(role: string | undefined): boolean {
  return inSet(CRM_FULL_PLUS_SM, role);
}

export function canBulkImportCrm(role: string | undefined): boolean {
  return inSet(CRM_FULL_PLUS_SM, role);
}

export function canViewSales(role: string | undefined): boolean {
  return inSet(CRM_FULL_PLUS_SM, role);
}

export function canManageSalesAgent(role: string | undefined): boolean {
  return inSet(CRM_FULL_PLUS_SM, role);
}

export function canViewChatbot(role: string | undefined): boolean {
  return inSet(CRM_FULL, role);
}

export function canManageChatbot(role: string | undefined): boolean {
  return inSet(CRM_FULL, role);
}

export function canViewCrmDashboard(role: string | undefined): boolean {
  return inSet(CRM_FULL_PLUS_SM, role);
}

/** Dati economici CRM dashboard: ADMIN/AD/CTO (full) + CFO (lettura). */
export function canViewCrmFinancials(role: string | undefined): boolean {
  return inSet(CRM_FULL, role) || role === 'CFO';
}

export function canViewCrmTeamUsers(role: string | undefined): boolean {
  return inSet(CRM_FULL_PLUS_SM, role);
}

export function canManageCrmTeamUsers(role: string | undefined): boolean {
  return inSet(CRM_FULL_PLUS_SM, role);
}

export function canViewCrmPermissions(role: string | undefined): boolean {
  return inSet(CRM_FULL, role);
}

/**
 * Riconciliazione CRM ↔ aziende registrate: vista e applicazione. Operazione
 * di massa sull'intera lista → solo CRM full (ADMIN/AD/CTO), fuori portata di
 * SALES_MANAGER e SALES.
 */
export function canRunCrmReconciliation(role: string | undefined): boolean {
  return inSet(CRM_FULL, role);
}

/**
 * Lista ruoli che il currentUser può creare/assegnare a nuovi utenti team.
 * Vedi spec §3 "Regole di management utenti".
 */
export function creatableCrmRoles(role: string | undefined): Role[] {
  if (role === 'ADMIN_PIATTAFORMA') {
    return ['ADMIN_PIATTAFORMA', 'AD', 'CTO', 'CFO', 'SALES_MANAGER', 'SALES'];
  }
  if (role === 'AD' || role === 'CTO') {
    // Non possono creare/promuovere ADMIN_PIATTAFORMA
    return ['AD', 'CTO', 'CFO', 'SALES_MANAGER', 'SALES'];
  }
  if (role === 'SALES_MANAGER') {
    return ['SALES'];
  }
  return [];
}

/**
 * Verifica se currentUser può gestire (modificare/eliminare) targetUser.
 * - Nessuno può gestire se stesso
 * - Solo ADMIN_PIATTAFORMA può gestire altri ADMIN_PIATTAFORMA
 * - AD/CTO non possono gestire ADMIN_PIATTAFORMA
 * - SALES_MANAGER può gestire solo SALES
 */
export function canManageCrmTeamUser(
  currentRole: string | undefined,
  currentId: string | undefined,
  target: { id: string; role: string },
): boolean {
  if (!currentRole || !currentId) return false;
  if (target.id === currentId) return false;
  if (target.role === 'ADMIN_PIATTAFORMA') return currentRole === 'ADMIN_PIATTAFORMA';
  if (currentRole === 'ADMIN_PIATTAFORMA') return true;
  if (currentRole === 'AD' || currentRole === 'CTO') {
    return target.role !== 'ADMIN_PIATTAFORMA';
  }
  if (currentRole === 'SALES_MANAGER') return target.role === 'SALES';
  return false;
}

/**
 * Manage di una campagna: ADMIN/AD/CTO sempre; SALES_MANAGER solo se è
 * owner. SALES nessun accesso (vedi canViewSales).
 */
export function canManageCrmCampaign(
  role: string | undefined,
  ownerId: string,
  currentId: string | undefined,
): boolean {
  if (inSet(CRM_FULL, role)) return true;
  if (role === 'SALES_MANAGER' && currentId === ownerId) return true;
  return false;
}
