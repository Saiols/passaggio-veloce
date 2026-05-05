import { redirect, RedirectType } from 'next/navigation';

/**
 * Backward-compat: la sezione "Contatti" e' stata rinominata in "CRM"
 * (item 18 release 2026-05). Manteniamo questo file solo per redirect
 * permanente verso la nuova route.
 */
export default function AdminContattiRedirect() {
  redirect('/admin/crm', RedirectType.replace);
}
