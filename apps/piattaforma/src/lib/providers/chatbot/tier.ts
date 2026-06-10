import type { Tier } from './kb/assemble';
export type { Tier };

const INTERNAL_ROLES = new Set([
  'ADMIN_PIATTAFORMA',
  'AD',
  'CTO',
  'CFO',
  'SALES_MANAGER',
  'SALES',
]);
const CLIENT_ROLES = new Set(['ADMIN_AZIENDA', 'UTENTE_AZIENDA', 'ASSISTENTE']);

/**
 * Mappa il ruolo utente sul tier di knowledge.
 * Default sicuro: ruolo assente o sconosciuto → 'public' (meno privilegiato).
 */
export function tierForRole(role: string | null | undefined): Tier {
  if (!role) return 'public';
  if (INTERNAL_ROLES.has(role)) return 'internal';
  if (CLIENT_ROLES.has(role)) return 'clients';
  return 'public';
}
