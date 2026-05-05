'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui';
import { updatePayoutThresholdAction } from './actions';

export function PayoutThresholdForm({
  defaultValueCent,
  minCent,
  maxCent,
}: {
  defaultValueCent: number;
  minCent: number;
  maxCent: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [valueCent, setValueCent] = useState<number>(defaultValueCent);

  const minEur = minCent / 100;
  const maxEur = maxCent / 100;
  const stepEur = 100; // step di 100€

  const handleSubmit = (e: React.FormEvent): void => {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = await updatePayoutThresholdAction(valueCent);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setSavedAt(Date.now());
      router.refresh();
    });
  };

  const valueEur = valueCent / 100;

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-3 sm:flex-row sm:items-end"
    >
      <label className="flex-1">
        <span className="text-[11px] font-bold uppercase tracking-wider text-pv-slate-500">
          Soglia €{minEur} - €{maxEur}
        </span>
        <div className="mt-1 flex items-center gap-3">
          <input
            type="range"
            min={minEur}
            max={maxEur}
            step={stepEur}
            value={valueEur}
            onChange={(e) => setValueCent(Number(e.target.value) * 100)}
            className="flex-1 accent-pv-navy-700"
          />
          <span className="w-24 shrink-0 text-right text-[15px] font-bold text-pv-navy-800">
            € {valueEur.toLocaleString('it-IT')}
          </span>
        </div>
      </label>
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? 'Salvataggio…' : 'Salva soglia'}
      </Button>
      {error && (
        <p className="basis-full text-[11px] text-pv-red-500">{error}</p>
      )}
      {savedAt && !error && (
        <p className="basis-full text-[11px] text-pv-green-500">Salvato.</p>
      )}
    </form>
  );
}
