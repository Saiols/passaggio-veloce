'use client';

import { useTransition } from 'react';
import { revokeInvitationAction } from './actions';

export function RevokeButton({ invitationId }: { invitationId: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => startTransition(() => revokeInvitationAction(invitationId))}
      className="rounded-lg border border-pv-red-500 px-3 py-1.5 text-xs font-semibold text-pv-red-500 hover:bg-pv-red-50 disabled:opacity-50"
    >
      Revoca
    </button>
  );
}
