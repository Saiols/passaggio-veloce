'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { richiediPayoutAction } from './actions';
import { MandatoFirmaModal } from './mandato-firma-modal';
import { PayoutConfirmModal, type WalletPreview } from './payout-confirm-modal';

export function PayoutButton({
  disabled,
  isTitolare,
  ragioneSociale,
  wallets,
}: {
  disabled: boolean;
  isTitolare: boolean;
  ragioneSociale: string;
  wallets: WalletPreview[];
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [mandatoOpen, setMandatoOpen] = useState(false);
  // FIX 3: key incrementale → React rimonta il modal ad ogni apertura, azzerando lo stato interno.
  const [modalKey, setModalKey] = useState(0);
  const [pending, startTransition] = useTransition();

  function openConfirm() {
    setError(null);
    setSuccess(null);
    setConfirmOpen(true);
  }

  function confirm() {
    setError(null);
    startTransition(async () => {
      const res = await richiediPayoutAction();
      if (res.ok) {
        setConfirmOpen(false);
        setSuccess('Payout eseguito. Il bonifico verrà accreditato a breve.');
        router.refresh();
        return;
      }
      if ('requireMandato' in res) {
        setConfirmOpen(false);
        setModalKey((k) => k + 1);
        setMandatoOpen(true);
        return;
      }
      // Errore: resta nella modale di conferma mostrando il motivo.
      setError(res.error);
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={openConfirm}
        disabled={disabled || pending}
        className="rounded-lg bg-pv-navy-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
      >
        Richiedi payout
      </button>
      {success && <p className="text-xs text-pv-green-500">{success}</p>}
      {/* Errore non-mandato mostrato anche fuori modale (es. se la modale è chiusa). */}
      {!confirmOpen && error && <p className="text-xs text-pv-red-500">{error}</p>}

      <PayoutConfirmModal
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={confirm}
        pending={pending}
        error={error}
        wallets={wallets}
      />
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
