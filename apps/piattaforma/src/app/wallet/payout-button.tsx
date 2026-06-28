'use client';

import { useState, useTransition } from 'react';
import { richiediPayoutAction } from './actions';
import { MandatoFirmaModal } from './mandato-firma-modal';

export function PayoutButton({
  disabled,
  isTitolare,
  ragioneSociale,
}: {
  disabled: boolean;
  isTitolare: boolean;
  ragioneSociale: string;
}) {
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [mandatoOpen, setMandatoOpen] = useState(false);
  // FIX 3: key incrementale → React rimonta il modal ad ogni apertura, azzerando lo stato interno.
  const [modalKey, setModalKey] = useState(0);
  const [pending, startTransition] = useTransition();

  function handle() {
    setError(null);
    setSuccess(null);
    startTransition(async () => {
      const res = await richiediPayoutAction();
      if (res.ok) {
        setSuccess("Richiesta inviata. L'admin la processerà a breve.");
        return;
      }
      if ('requireMandato' in res) {
        setModalKey((k) => k + 1);
        setMandatoOpen(true);
        return;
      }
      setError(res.error);
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
      <MandatoFirmaModal
        key={modalKey}
        open={mandatoOpen}
        onClose={() => setMandatoOpen(false)}
        isTitolare={isTitolare}
        ragioneSociale={ragioneSociale}
      />
    </div>
  );
}
