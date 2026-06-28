'use client';

import { useState, useTransition } from 'react';
import { richiediPayoutAction } from './actions';

export function PayoutButton({ disabled }: { disabled: boolean }) {
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handle() {
    setError(null);
    setSuccess(null);
    startTransition(async () => {
      const res = await richiediPayoutAction();
      if (!res.ok) {
        if ('requireMandato' in res) {
          setError('Firma il mandato di fatturazione prima di richiedere il payout.');
        } else {
          setError(res.error);
        }
      } else {
        setSuccess("Richiesta inviata. L'admin la processerà a breve.");
      }
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={handle}
        disabled={disabled || pending}
        className="rounded-lg bg-pv-navy-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
      >
        {pending ? 'Invio…' : 'Richiedi payout'}
      </button>
      {error && <p className="text-xs text-pv-red-500">{error}</p>}
      {success && <p className="text-xs text-pv-green-500">{success}</p>}
    </div>
  );
}
