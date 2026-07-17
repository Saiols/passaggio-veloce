'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { revocaERimettiInCircoloAction } from './actions';

export function RevocaButton({
  praticaId,
  codicePratica,
  agenzia,
}: {
  praticaId: string;
  codicePratica: string;
  agenzia: string;
}) {
  const [open, setOpen] = useState(false);
  const [motivo, setMotivo] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function conferma() {
    setError(null);
    startTransition(async () => {
      const res = await revocaERimettiInCircoloAction(praticaId, motivo);
      if (res.ok) {
        setOpen(false);
        setMotivo('');
        router.refresh();
      } else {
        setError(res.error);
      }
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-[10px] border border-pv-slate-300 bg-white px-3 py-1.5 text-[12px] font-semibold text-pv-red-500 hover:bg-pv-red-50"
      >
        Revoca
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-md rounded-[16px] bg-white p-6 shadow-[var(--pv-shadow-card)]">
            <h2 className="text-[18px] font-bold text-pv-navy-900">Revoca e rimetti in circolo</h2>
            <p className="mt-2 text-[13px] text-pv-slate-600">
              Stai per togliere <strong>{codicePratica}</strong> a <strong>{agenzia}</strong> e rimetterla in
              distribuzione nella zona. L&apos;agenzia riceverà una email e non verrà più ricontattata per questa
              pratica. Broker e clienti saranno informati.
            </p>
            <label htmlFor="motivo-revoca" className="mt-4 block text-[12px] font-semibold text-pv-slate-700">
              Nota (opzionale)
            </label>
            <textarea
              id="motivo-revoca"
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              rows={3}
              className="mt-1 w-full rounded-[10px] border border-pv-slate-300 p-2 text-[13px]"
              placeholder="Es. agenzia non risponde da giorni"
            />
            {error && <p className="mt-2 text-[12px] text-pv-red-500">{error}</p>}
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                disabled={pending}
                onClick={() => setOpen(false)}
                className="rounded-[10px] border border-pv-slate-300 bg-white px-3 py-1.5 text-[13px] font-semibold text-pv-navy-700 hover:bg-pv-slate-50 disabled:opacity-60"
              >
                Annulla
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={conferma}
                className="rounded-[10px] bg-pv-red-500 px-3 py-1.5 text-[13px] font-semibold text-white hover:opacity-90 disabled:opacity-60"
              >
                {pending ? 'Revoca in corso…' : 'Conferma revoca'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
