'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, Button } from '@/components/ui';
import { LoadingOverlay } from '@/components/ui/loading-overlay';
import { suspendSedeAction, reactivateSedeAction } from '../actions';

/**
 * Bottone Sospendi/Riattiva della sede. Cattura l'esito dell'action invece di
 * scartarlo: quando `ok: false` (es. sanzione anti-abuso non revocabile dal
 * sanzionato — vedi `setSedeSuspended` in `../actions.ts`) l'errore va
 * mostrato, non ignorato, altrimenti l'utente sanzionato clicca "Riattiva" e
 * non succede nulla, senza sapere perché né cosa fare (clausola 12.2 dei
 * Termini promette il rimedio "scrivi ad assistenza@").
 */
export function SuspendToggle({
  sedeId,
  suspended,
}: {
  sedeId: string;
  suspended: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const handleClick = (): void => {
    setError(null);
    startTransition(async () => {
      const res = suspended
        ? await reactivateSedeAction(sedeId)
        : await suspendSedeAction(sedeId);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.refresh();
    });
  };

  return (
    <div className="flex flex-col items-end gap-2">
      <Button
        type="button"
        variant="secondary"
        size="sm"
        onClick={handleClick}
        disabled={pending}
        loading={pending}
        loadingLabel={suspended ? 'Riattivazione…' : 'Sospensione…'}
      >
        {suspended ? 'Riattiva' : 'Sospendi'}
      </Button>
      {error && (
        <div className="max-w-xs">
          <Alert variant="error">{error}</Alert>
        </div>
      )}
      <LoadingOverlay
        show={pending}
        label={suspended ? 'Riattivazione…' : 'Sospensione…'}
      />
    </div>
  );
}
