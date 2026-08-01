'use client';

import { useState } from 'react';
import { Button } from '@/components/ui';
import { bulkHardDeleteCrmContactsAction } from './actions';
import type { FiltroContatti } from '@/lib/crm/contatti-filtro';

/**
 * Barra azioni + dialog di conferma per l'eliminazione massiva DEFINITIVA.
 * `tuttiIFiltrati` sceglie la modalità server: per filtro (tutto il result set,
 * meno `escludi`) oppure per elenco esplicito di `ids`.
 */
export function BulkDeleteBar({
  conteggio,
  tuttiIFiltrati,
  ids,
  filtro,
  escludi,
  onDone,
}: {
  conteggio: number;
  tuttiIFiltrati: boolean;
  ids: string[];
  filtro: FiltroContatti;
  escludi: string[];
  onDone: () => void;
}) {
  const [aperto, setAperto] = useState(false);
  const [capito, setCapito] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const chiudi = () => {
    setAperto(false);
    setCapito(false);
    setError(null);
  };

  const elimina = async () => {
    setPending(true);
    setError(null);
    const res = tuttiIFiltrati
      ? await bulkHardDeleteCrmContactsAction({ modo: 'filtro', filtro, escludi })
      : await bulkHardDeleteCrmContactsAction({ modo: 'ids', ids });
    setPending(false);
    if (res.ok) {
      chiudi();
      onDone();
    } else {
      setError(res.error);
    }
  };

  return (
    <>
      <div className="mb-2 flex items-center gap-3 rounded-[10px] border border-pv-red-200 bg-pv-red-50 px-3 py-2">
        <span className="text-[12.5px] font-semibold text-pv-red-700">
          {conteggio} selezionat{conteggio === 1 ? 'o' : 'i'}
        </span>
        <Button variant="danger" size="sm" onClick={() => setAperto(true)} disabled={conteggio === 0}>
          Elimina definitivamente ({conteggio})
        </Button>
      </div>

      {aperto && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-pv-navy-900/40 px-4"
          onClick={chiudi}
        >
          <div
            className="w-full max-w-md rounded-[16px] bg-white p-5 shadow-[var(--pv-shadow-card-lg)]"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-[15px] font-bold text-pv-red-700">
              Eliminare {conteggio} contatt{conteggio === 1 ? 'o' : 'i'}?
            </h3>
            <p className="mt-2 text-[12.5px] text-pv-slate-600">
              L&apos;operazione è <strong>irreversibile</strong>: cancella i contatti dal database,
              insieme alle loro chiamate e assegnazioni campagne collegate.
            </p>
            <label className="mt-3 flex items-center gap-2 text-[12.5px] text-pv-slate-700">
              <input type="checkbox" checked={capito} onChange={(e) => setCapito(e.target.checked)} />
              Capisco che è irreversibile
            </label>
            {error && <p className="mt-2 text-[12.5px] font-medium text-pv-red-500">{error}</p>}
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="secondary" size="sm" onClick={chiudi} disabled={pending}>
                Annulla
              </Button>
              <Button
                variant="danger"
                size="sm"
                onClick={elimina}
                disabled={!capito || pending}
                loading={pending}
                loadingLabel="Elimino…"
              >
                Elimina definitivamente
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
