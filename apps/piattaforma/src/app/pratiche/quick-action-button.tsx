'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  markPraticaProcessataAction,
  markFirmaAvvenutaAction,
} from './actions';

type Action = 'processata' | 'firma';

const COPY: Record<Action, { label: string; confirm: string }> = {
  processata: {
    label: 'Processata',
    confirm: 'Confermi che la pratica è stata processata? Il broker riceverà notifica.',
  },
  firma: {
    label: 'Firmata',
    confirm: 'Confermi che la firma è avvenuta? Verrà accreditato il broker e schedulato l\'addebito.',
  },
};

/**
 * Bottone inline nella lista pratiche per far avanzare lo stato senza dover
 * aprire il dettaglio (item 8 release 2026-05). Effetto pulsante per richiamare
 * attenzione (rispetta prefers-reduced-motion).
 */
export function QuickActionButton({
  praticaId,
  action,
}: {
  praticaId: string;
  action: Action;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const c = COPY[action];

  const onClick = (e: React.MouseEvent<HTMLButtonElement>): void => {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm(c.confirm)) return;
    startTransition(async () => {
      try {
        if (action === 'processata') {
          await markPraticaProcessataAction(praticaId);
        } else {
          await markFirmaAvvenutaAction(praticaId);
        }
      } catch {
        // Le server action fanno redirect. In caso di errore lo stato si
        // aggiorna comunque al refresh.
      }
      router.refresh();
    });
  };

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      aria-busy={pending || undefined}
      className="animate-pulse-soft relative z-20 inline-flex items-center gap-1.5 rounded-full bg-pv-navy-600 px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-white hover:bg-pv-navy-700 disabled:opacity-50 disabled:animate-none"
    >
      {pending && (
        <svg
          className="h-3 w-3 animate-spin"
          viewBox="0 0 24 24"
          fill="none"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" strokeOpacity="0.25" />
          <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
        </svg>
      )}
      <span>{pending ? 'Invio…' : c.label}</span>
    </button>
  );
}
