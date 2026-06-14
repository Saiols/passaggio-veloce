'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, Button, useToast } from '@/components/ui';
import { segnaTrasmessoSdiAction } from '../actions';

/**
 * FT-D: bottone visibile al broker emittente di un DOC_BROKER non ancora
 * trasmesso. Marca il documento come trasmesso allo SDI (operazione manuale).
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
      toast('Documento segnato come trasmesso allo SDI', 'success');
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
        Segna come trasmesso allo SDI
      </Button>
      {error && <Alert variant="error">{error}</Alert>}
    </div>
  );
}
