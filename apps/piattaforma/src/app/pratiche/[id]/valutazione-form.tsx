'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, Button, Card, useToast } from '@/components/ui';
import { LoadingOverlay } from '@/components/ui/loading-overlay';
import { submitValutazioneAction } from '../actions';

type Props = {
  praticaId: string;
  agenziaNome: string;
};

export function ValutazioneForm({ praticaId, agenziaNome }: Props) {
  const [stelle, setStelle] = useState<number>(0);
  const [hover, setHover] = useState<number>(0);
  const [note, setNote] = useState('');
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const toast = useToast();

  const display = hover || stelle;

  const canSubmit = stelle >= 1 && stelle <= 5;

  const handleSubmit = () => {
    if (!canSubmit) return;
    setError(null);
    const fd = new FormData();
    fd.append('praticaId', praticaId);
    fd.append('stelle', String(stelle));
    if (note.trim()) fd.append('note', note.trim());

    startTransition(async () => {
      const result = await submitValutazioneAction(fd);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      toast('Valutazione inviata', 'success');
      router.refresh();
    });
  };

  return (
    <Card className="border-pv-orange-500/40 bg-[color-mix(in_srgb,#ff7a00_6%,white)]">
      <div>
        <p className="text-[11px] font-bold uppercase tracking-wider text-pv-orange-500">
          Valuta l&apos;agenzia
        </p>
        <h2 className="mt-1 text-[16px] font-bold text-pv-navy-800">
          Com&apos;è stata l&apos;esperienza con {agenziaNome}?
        </h2>
        <p className="mt-0.5 text-[13px] text-pv-slate-500">
          Il tuo feedback influenza l&apos;ordine con cui verranno proposte le agenzie sulle prossime pratiche.
        </p>
      </div>

      {error && (
        <div className="mt-4">
          <Alert variant="error">{error}</Alert>
        </div>
      )}

      <div className="mt-4 flex items-center gap-1" onMouseLeave={() => setHover(0)}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            aria-label={`${n} stelle`}
            onClick={() => setStelle(n)}
            onMouseEnter={() => setHover(n)}
            className="group text-[32px] leading-none transition-transform hover:scale-110"
          >
            <span
              className={
                n <= display
                  ? 'text-pv-orange-500 drop-shadow-[0_2px_6px_rgb(255_122_0_/_0.30)]'
                  : 'text-pv-slate-300'
              }
            >
              ★
            </span>
          </button>
        ))}
        <span className="ml-3 text-[13px] font-semibold text-pv-slate-700">
          {stelle > 0 ? `${stelle}/5` : 'Seleziona una valutazione'}
        </span>
      </div>

      <div className="mt-4">
        <label
          htmlFor="val-note"
          className="mb-1.5 block text-[12.5px] font-semibold text-pv-slate-700"
        >
          Note (opzionale)
        </label>
        <textarea
          id="val-note"
          rows={3}
          value={note}
          maxLength={500}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Cos'è andato bene? Cosa si può migliorare?"
          className="block w-full resize-none rounded-[10px] border-[1.5px] border-transparent bg-pv-navy-100 px-[14px] py-2.5 text-[13px] font-medium text-pv-slate-900 placeholder:text-pv-slate-500 focus:border-pv-navy-600 focus:bg-white focus:outline-none focus:shadow-[var(--pv-ring-focus)]"
        />
        <p className="mt-1 text-right text-[11px] text-pv-slate-500">
          {note.length}/500
        </p>
      </div>

      <div className="mt-5 flex justify-end">
        <Button
          onClick={handleSubmit}
          disabled={!canSubmit}
          loading={isPending}
          loadingLabel="Invio in corso…"
        >
          Invia valutazione
        </Button>
      </div>
      <LoadingOverlay show={isPending} label="Invio valutazione…" />
    </Card>
  );
}
