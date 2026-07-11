'use client';

import { useTransition } from 'react';
import { InlineSpinner } from '@/components/ui';
import { LoadingOverlay } from '@/components/ui/loading-overlay';
import { reactivateSedeAntiAbusoAction } from './suspension-actions';

/**
 * Riattiva una sede sospesa dall'anti-abuso (5 no-show consecutivi). È
 * l'unico modo per farlo: `setSedeSuspended` (self-service in /sedi) rifiuta
 * la riattivazione quando `suspensionOrigin === 'ANTI_ABUSO'` — cfr.
 * `apps/piattaforma/src/app/sedi/actions.ts`.
 */
export function ReactivateSedeButton({ sedeId }: { sedeId: string }) {
  const [pending, startTransition] = useTransition();

  const submit = (): void => {
    startTransition(async () => {
      await reactivateSedeAntiAbusoAction(sedeId);
    });
  };

  return (
    <>
      <button
        type="button"
        onClick={submit}
        disabled={pending}
        aria-busy={pending || undefined}
        className="inline-flex items-center gap-1.5 rounded-[8px] border border-pv-green-500/40 bg-pv-green-50 px-2.5 py-1 text-[11px] font-semibold text-pv-green-500 hover:brightness-95 disabled:opacity-50"
      >
        {pending && <InlineSpinner className="h-3.5 w-3.5" />}
        <span>{pending ? 'Riattivazione…' : 'Riattiva sede'}</span>
      </button>
      <LoadingOverlay show={pending} label="Riattivazione…" />
    </>
  );
}
