'use client';

import { useFormStatus } from 'react-dom';
import { InlineSpinner } from '@/components/ui';

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
      {pending && <InlineSpinner className="h-4 w-4" />}
      <span>{pending ? 'Salvataggio…' : 'Salva preferenze'}</span>
    </button>
  );
}
