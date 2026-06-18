'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, Button, useToast } from '@/components/ui';
import { segnaTrasmessoSdiAction } from '../actions';

/**
 * Bottone visibile solo all'admin di PV: marca il documento come "gestito dal
 * commercialista" (emesso/trasmesso allo SdI fuori piattaforma). Non trasmette
 * nulla, è solo tracciamento interno.
 */
export function SegnaTrasmessoButton({ documentoId }: { documentoId: string }) {
  const router = useRouter();
  const toast = useToast();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const handleClick = (): void => {
    setError(null);
    startTransition(async () => {
      const res = await segnaTrasmessoSdiAction(documentoId);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      toast('Documento segnato come gestito dal commercialista', 'success');
      router.refresh();
    });
  };

  return (
    <div className="space-y-2">
      <Button
        type="button"
        size="sm"
        onClick={handleClick}
        disabled={pending}
        loading={pending}
        loadingLabel="Aggiornamento…"
      >
        Segna come gestito dal commercialista
      </Button>
      {error && <Alert variant="error">{error}</Alert>}
    </div>
  );
}
