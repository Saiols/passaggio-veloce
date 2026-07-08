'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, Button } from '@/components/ui';
import { LoadingOverlay } from '@/components/ui/loading-overlay';
import { gestisciSegnalazioneCreazioneAction } from '@/lib/segnalazioni/creazione';

/**
 * Form admin per rispondere a una segnalazione APERTA da creazione pratica.
 * Un solo esito (nessuna scelta RISOLTA/ANNULLATA: la segnalazione non blocca
 * alcuna pratica) — una nota che diventa la risposta email al broker (N42).
 */
export function GestisciSegnalazione({ id }: { id: string }) {
  const router = useRouter();
  const [nota, setNota] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const handleSubmit = (): void => {
    setError(null);
    startTransition(async () => {
      const res = await gestisciSegnalazioneCreazioneAction(id, nota);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.refresh();
    });
  };

  return (
    <div className="space-y-3">
      <label className="block">
        <span className="text-[12px] font-semibold text-pv-slate-700">
          Risposta al broker (max 2000 char)
        </span>
        <textarea
          value={nota}
          onChange={(e) => setNota(e.target.value)}
          maxLength={2000}
          rows={4}
          placeholder="Es. La targa corretta è AB123CD, correggi il campo prima di procedere."
          className="mt-1 w-full rounded-[10px] border-[1.5px] border-pv-slate-300 px-3 py-2 text-[13px]"
        />
        <span className="mt-1 block text-right text-[10px] text-pv-slate-500">
          {nota.length}/2000
        </span>
      </label>
      {error && <Alert variant="error">{error}</Alert>}
      <div className="flex justify-end">
        <Button
          variant="primary"
          onClick={handleSubmit}
          disabled={pending || nota.trim().length === 0}
          loading={pending}
          loadingLabel="Invio…"
        >
          Segna gestita e invia risposta
        </Button>
      </div>
      <LoadingOverlay show={pending} label="Attendere…" />
    </div>
  );
}
