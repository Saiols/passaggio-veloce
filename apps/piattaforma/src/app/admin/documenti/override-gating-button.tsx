'use client';

import { useTransition } from 'react';
import { InlineSpinner } from '@/components/ui';
import { LoadingOverlay } from '@/components/ui/loading-overlay';
import { overrideGatingAction } from './actions';

export function OverrideGatingButton({ documentoId }: { documentoId: string }) {
  const [pending, startTransition] = useTransition();

  const onClick = (): void => {
    if (
      !confirm(
        'Forzare PASSED su questo documento? La decisione verrà tracciata in audit log.',
      )
    )
      return;
    startTransition(async () => {
      await overrideGatingAction(documentoId);
    });
  };

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      aria-busy={pending || undefined}
      className="inline-flex items-center justify-center gap-1 rounded-[8px] border border-pv-orange-500/40 bg-pv-orange-50 px-2 py-1 text-[11px] font-semibold text-pv-orange-500 hover:brightness-95 disabled:opacity-50"
    >
      {pending && <InlineSpinner className="h-3 w-3" />}
      <span>{pending ? 'Forza…' : 'Forza PASSED'}</span>
      <LoadingOverlay show={pending} label="Attendere…" />
    </button>
  );
}
