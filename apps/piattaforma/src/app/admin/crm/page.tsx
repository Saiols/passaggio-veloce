import { redirect, RedirectType } from 'next/navigation';

/**
 * Hub CRM: redirect alla tab di default "Pipeline lead".
 * Pattern coerente con altri admin hub (es. /admin/contatti → /admin/crm).
 *
 * Le 2 tab vivono come pagine separate sotto l'hub:
 * - /admin/crm/contatti → CrmContact pre-iscrizione (lead pipeline)
 * - /admin/crm/contatti-operativi → catalogo dedupli­cato post-iscrizione
 *
 * Spec: docs/crm-spec-implementativa.md §1.
 */
export default function AdminCrmHubPage() {
  redirect('/admin/crm/contatti', RedirectType.replace);
}
