'use client';

import { useState, useTransition } from 'react';
import { InlineSpinner } from '@/components/ui';
import { LoadingOverlay } from '@/components/ui/loading-overlay';
import { revokeInvitationAction } from './actions';

export function RevokeButton({ invitationId }: { invitationId: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            setError(null);
            const res = await revokeInvitationAction(invitationId);
            if (!res.ok) setError(res.error);
          })
        }
        aria-busy={pending || undefined}
        className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-pv-red-500 px-3 py-1.5 text-xs font-semibold text-pv-red-500 hover:bg-pv-red-50 disabled:opacity-50"
      >
        {pending && <InlineSpinner className="h-3.5 w-3.5" />}
        <span>{pending ? 'Revoca…' : 'Revoca'}</span>
        <LoadingOverlay show={pending} label="Revoca…" />
      </button>
      {error && <span className="text-[11px] text-pv-red-500">{error}</span>}
    </div>
  );
}
