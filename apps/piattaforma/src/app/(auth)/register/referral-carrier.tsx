'use client';

import { useSearchParams } from 'next/navigation';

/**
 * Helper client component: legge ?ref= dalla URL e lo passa ai figli come
 * stringa pronta per essere appesa al link (es. "?ref=abc"). Se non c'e'
 * referral, ritorna stringa vuota. Cosi' la landing /register puo' essere
 * statica e i due percorsi /register/dealer e /register/agenzia preservano
 * il tracking affiliazione.
 */
export function ReferralCarrier({
  children,
}: {
  children: (refQuery: string) => React.ReactNode;
}) {
  const sp = useSearchParams();
  const ref = sp.get('ref');
  const refQuery = ref ? `?ref=${encodeURIComponent(ref)}` : '';
  return <>{children(refQuery)}</>;
}
