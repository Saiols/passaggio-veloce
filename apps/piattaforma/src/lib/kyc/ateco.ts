import type { CompanyType } from '@pv/db';

export function normalizeAteco(s: string): string {
  return s.replace(/[^0-9]/g, '');
}

export type AllowedAteco = { companyType: CompanyType; code: string; active: boolean };

/** True se l'ATECO della visura inizia con un codice ammesso ATTIVO per quel tipo azienda. */
export function isAtecoAllowed(
  visuraAteco: string | undefined,
  companyType: CompanyType,
  allowed: AllowedAteco[],
): boolean {
  if (!visuraAteco) return false;
  const norm = normalizeAteco(visuraAteco);
  if (!norm) return false;
  return allowed.some(
    (a) => a.active && a.companyType === companyType && norm.startsWith(a.code),
  );
}
