'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, Button } from '@/components/ui';
import { risolviRevisioneAction } from '@/lib/documenti/revisione';

/**
 * Schema Documentale v7 (SD-C release 2026-05): form admin per chiudere
 * una revisione manuale. Due esiti: RISOLTA (broker può proseguire con le
 * note) o ANNULLATA (pratica chiusa).
 */
export function ChiudiRevisioneForm({ praticaId }: { praticaId: string }) {
  const router = useRouter();
  const [esito, setEsito] = useState<'RISOLTA' | 'ANNULLATA'>('RISOLTA');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const handleSubmit = (): void => {
    if (esito === 'ANNULLATA') {
      if (!confirm('Confermi annullamento della pratica?')) return;
    }
    setError(null);
    startTransition(async () => {
      const res = await risolviRevisioneAction(praticaId, esito, note);
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
        <span className="text-[12px] font-semibold text-pv-slate-700">Esito</span>
        <select
          value={esito}
          onChange={(e) =>
            setEsito(e.target.value as 'RISOLTA' | 'ANNULLATA')
          }
          className="mt-1 w-full rounded-[10px] border-[1.5px] border-pv-slate-300 px-3 py-2 text-[13px]"
        >
          <option value="RISOLTA">
            Risolta — broker può proseguire con queste indicazioni
          </option>
          <option value="ANNULLATA">
            Annullata — situazione non gestibile, pratica chiusa
          </option>
        </select>
      </label>
      <label className="block">
        <span className="text-[12px] font-semibold text-pv-slate-700">
          Note per il broker (max 1000 char)
        </span>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={1000}
          rows={4}
          placeholder={
            esito === 'RISOLTA'
              ? "Es. Carica i documenti X, Y, Z. La pratica può procedere come passaggio standard."
              : 'Es. Situazione non gestibile dalla piattaforma, contatta direttamente il PRA.'
          }
          className="mt-1 w-full rounded-[10px] border-[1.5px] border-pv-slate-300 px-3 py-2 text-[13px]"
        />
        <span className="mt-1 block text-right text-[10px] text-pv-slate-500">
          {note.length}/1000
        </span>
      </label>
      {error && <Alert variant="error">{error}</Alert>}
      <div className="flex justify-end">
        <Button
          variant={esito === 'ANNULLATA' ? 'danger' : 'primary'}
          onClick={handleSubmit}
          disabled={pending}
          loading={pending}
          loadingLabel="In corso…"
        >
          {esito === 'RISOLTA' ? 'Chiudi come risolta' : 'Annulla pratica'}
        </Button>
      </div>
    </div>
  );
}
