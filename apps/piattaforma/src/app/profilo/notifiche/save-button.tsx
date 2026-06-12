'use client';

import { useFormStatus } from 'react-dom';

/**
 * Submit "Salva preferenze" della pagina notifiche. Il form è in un server
 * component, quindi serve un client component per leggere useFormStatus() e
 * mostrare lo spinner mentre la server action è in corso.
 */
export function SalvaPreferenzeButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending || undefined}
      className="inline-flex items-center gap-2 rounded-[10px] bg-pv-navy-700 px-4 py-2 text-[13px] font-bold text-white hover:brightness-110 disabled:cursor-wait disabled:opacity-60"
    >
      {pending && (
        <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.5" strokeOpacity="0.25" />
          <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
        </svg>
      )}
      <span>{pending ? 'Salvataggio…' : 'Salva preferenze'}</span>
    </button>
  );
}
