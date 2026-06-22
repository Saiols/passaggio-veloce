'use client';

import { useState, useTransition } from 'react';
import { Button } from '@/components/ui';
import { annullaPraticaAction } from '../actions';

/**
 * Annullamento pratica da parte del broker, con conferma in MODALE graficata
 * (non un window.confirm). Il trigger è de-enfatizzato (link rosso): l'obiettivo
 * è completare la pratica, l'annullamento resta possibile ma poco evidente.
 *
 * annullaPraticaAction fa redirect sull'esito (success → ?annullata con toast,
 * errore → ?error con toast), quindi qui basta invocarla in una transition.
 */
export function AnnullaPraticaButton({ praticaId }: { praticaId: string }) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center py-2 text-[12px] font-medium text-pv-red-500 transition-colors hover:text-pv-red-600 focus-visible:outline-none focus-visible:shadow-[var(--pv-ring-focus)]"
      >
        Annulla pratica
      </button>
    );
  }

  const handleConfirm = (): void => {
    startTransition(async () => {
      await annullaPraticaAction(praticaId);
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-pv-navy-900/40 px-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="annulla-pratica-titolo"
    >
      <div className="w-full max-w-md rounded-[20px] bg-white p-6 shadow-[var(--pv-shadow-card-lg)]">
        <h2 id="annulla-pratica-titolo" className="text-[18px] font-extrabold text-pv-navy-900">
          Annullare la pratica?
        </h2>
        <p className="mt-1 text-[12.5px] text-pv-slate-500">
          La pratica verrà annullata in modo definitivo. Se è già stata assegnata
          a un&apos;agenzia, questa verrà avvisata. L&apos;operazione non è
          reversibile.
        </p>

        <div className="mt-5 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <Button variant="secondary" onClick={() => setOpen(false)} disabled={pending}>
            No, mantieni la pratica
          </Button>
          <Button
            variant="danger"
            onClick={handleConfirm}
            disabled={pending}
            loading={pending}
            loadingLabel="Annullamento…"
          >
            Sì, annulla pratica
          </Button>
        </div>
      </div>
    </div>
  );
}
