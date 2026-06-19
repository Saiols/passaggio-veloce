'use client';

import { useRouter } from 'next/navigation';

/**
 * "Indietro" per i dettagli visti dallo staff (admin/assistente): le liste
 * /pratiche e /fatturazione sono dei broker/agenzia (mostrano "account non
 * associato"/"disponibili per agenzie e broker" agli admin), quindi qui si
 * torna semplicemente alla route precedente. Fallback a `fallbackHref` se non
 * c'è cronologia (es. apertura diretta del link).
 */
export function BackButton({
  label = '← Indietro',
  fallbackHref = '/dashboard',
}: {
  label?: string;
  fallbackHref?: string;
}) {
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={() => {
        if (typeof window !== 'undefined' && window.history.length > 1) router.back();
        else router.push(fallbackHref);
      }}
      className="mb-5 inline-flex items-center gap-1 text-[13px] font-semibold text-pv-navy-600 hover:underline underline-offset-4"
    >
      {label}
    </button>
  );
}
