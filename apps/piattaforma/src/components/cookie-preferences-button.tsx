'use client';

import { riapriPreferenzeCookie } from '@/components/cookie-banner';

/**
 * Riapre il banner del consenso dalla cookie policy.
 *
 * Non è un vezzo di UX: da quando Google Analytics è installato, la revoca
 * dev'essere possibile «in qualsiasi momento» e con la stessa facilità con cui
 * si è acconsentito (art. 7.3 GDPR). Prima la policy suggeriva di cancellare a
 * mano il LocalStorage — una via che nessun utente reale percorre.
 */
export function CookiePreferencesButton() {
  return (
    <button
      type="button"
      onClick={riapriPreferenzeCookie}
      className="rounded-[10px] bg-pv-navy-700 px-4 py-2 text-[13px] font-semibold text-white hover:bg-pv-navy-800"
    >
      Gestisci le preferenze cookie
    </button>
  );
}
