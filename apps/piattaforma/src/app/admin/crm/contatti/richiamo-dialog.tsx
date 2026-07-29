'use client';

import { useState } from 'react';
import { Button } from '@/components/ui';
import { OPZIONI_FASCIA } from '@/lib/crm/richiamo';

/**
 * Mini-modale che raccoglie giorno e fascia di un richiamo.
 *
 * Il giorno è obbligatorio e il bottone resta disabilitato finché manca: così
 * non esiste un istante in cui il contatto è in S11 senza sapere quando
 * richiamarlo. Riaprendolo su un richiamo già programmato, i campi arrivano
 * precompilati — riprogrammare è spostare un appuntamento, non riscriverlo.
 */
export function RichiamoDialog({
  giornoIniziale,
  fasciaIniziale,
  pending,
  onConferma,
  onAnnulla,
}: {
  giornoIniziale: string;
  fasciaIniziale: string;
  pending: boolean;
  onConferma: (giorno: string, fascia: string) => void;
  onAnnulla: () => void;
}) {
  const [giorno, setGiorno] = useState(giornoIniziale);
  const [fascia, setFascia] = useState(fasciaIniziale);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Programma il richiamo"
      className="fixed inset-0 z-50 flex items-center justify-center bg-pv-navy-900/40 px-4"
      onClick={onAnnulla}
    >
      <div
        className="w-full max-w-sm rounded-[16px] bg-white p-5 shadow-[var(--pv-shadow-card-lg)]"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-[15px] font-bold text-pv-navy-900">
          Richiamare questo contatto
        </h3>

        <label className="mt-3 block text-[12.5px] font-semibold text-pv-slate-700">
          Giorno *
          <input
            type="date"
            value={giorno}
            disabled={pending}
            onChange={(e) => setGiorno(e.target.value)}
            className="mt-1 block w-full rounded-[10px] border-[1.5px] border-pv-slate-300 px-3 py-2 text-[13px]"
          />
        </label>

        <label className="mt-3 block text-[12.5px] font-semibold text-pv-slate-700">
          Fascia
          <select
            value={fascia}
            disabled={pending}
            onChange={(e) => setFascia(e.target.value)}
            className="mt-1 block w-full rounded-[10px] border-[1.5px] border-pv-slate-300 px-3 py-2 text-[13px]"
          >
            {OPZIONI_FASCIA.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>

        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={onAnnulla} disabled={pending}>
            Annulla
          </Button>
          <Button
            size="sm"
            onClick={() => onConferma(giorno, fascia)}
            disabled={pending || !giorno}
            loading={pending}
            loadingLabel="Salvataggio…"
          >
            Programma
          </Button>
        </div>
      </div>
    </div>
  );
}
