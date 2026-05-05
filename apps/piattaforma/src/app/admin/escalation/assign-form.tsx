'use client';

import { useState, useTransition } from 'react';
import { assegnaEscalationAction } from './actions';

type Agenzia = {
  id: string;
  ragioneSociale: string;
  avgStars: number | null;
  numValutazioni: number;
};

function formatRating(a: Agenzia): string {
  if (a.numValutazioni === 0 || a.avgStars === null) {
    return '★ — (nuova)';
  }
  return `★ ${a.avgStars.toFixed(1)} (${a.numValutazioni})`;
}

export function AssignForm({
  praticaId,
  agenzie,
}: {
  praticaId: string;
  agenzie: Agenzia[];
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [selected, setSelected] = useState<string>('');

  function handle() {
    if (!selected) {
      setError("Seleziona un'agenzia");
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await assegnaEscalationAction(praticaId, selected);
      if (!res.ok) setError(res.error);
    });
  }

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
      <select
        value={selected}
        onChange={(e) => setSelected(e.target.value)}
        className="rounded-lg border border-pv-slate-300 px-3 py-2 text-sm"
      >
        <option value="">Scegli agenzia…</option>
        {agenzie.map((a) => (
          <option key={a.id} value={a.id}>
            {a.ragioneSociale} · {formatRating(a)}
          </option>
        ))}
      </select>
      <button
        type="button"
        onClick={handle}
        disabled={pending}
        className="rounded-lg bg-pv-navy-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
      >
        {pending ? 'Assegnazione…' : 'Assegna'}
      </button>
      {error && <p className="basis-full text-xs text-pv-red-500">{error}</p>}
    </div>
  );
}
