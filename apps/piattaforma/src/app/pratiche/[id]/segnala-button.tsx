'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, Button, useToast } from '@/components/ui';
import { LoadingOverlay } from '@/components/ui/loading-overlay';
import {
  segnalaPraticaAction,
  type SegnalazioneTipo,
} from '@/lib/penali/segnalazione';

const TIPI: { value: SegnalazioneTipo; label: string }[] = [
  { value: 'FERMO_AMMINISTRATIVO', label: 'Fermo amministrativo' },
  { value: 'IPOTECA', label: 'Ipoteca / vincolo' },
  { value: 'DOCUMENTO_NON_VALIDO', label: 'Documento non valido' },
  { value: 'ALTRO', label: 'Altro problema' },
];

/**
 * Sistema Penali Broker — SP-B: bottone visibile all'agenzia assegnata
 * sulla scheda pratica, in stati ACCETTATA o PROCESSATA. Apre form modale
 * con select tipo + textarea nota.
 */
export type VeicoloSegnalabile = { id: string; targa: string | null };

export function SegnalaProblemaButton({
  praticaId,
  veicoli,
}: {
  praticaId: string;
  veicoli: VeicoloSegnalabile[];
}) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [tipo, setTipo] = useState<SegnalazioneTipo>('FERMO_AMMINISTRATIVO');
  const [nota, setNota] = useState('');
  // Monoveicolo: preselezionato e non modificabile — non c'è nulla da scegliere.
  const [selected, setSelected] = useState<string[]>(
    veicoli.length === 1 ? [veicoli[0].id] : [],
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!open) {
    // De-enfatizzato di proposito: azione secondaria (stile link rosso, senza
    // sfondo né sottolineatura). L'obiettivo è far completare la pratica; questa
    // funzione deve esserci ma saltare poco all'occhio.
    return (
      <button
        type="button"
        onClick={() => {
          setOpen(true);
          setError(null);
        }}
        className="mr-[15px] inline-flex items-center py-2 text-[12px] font-medium text-pv-red-500 transition-colors hover:text-pv-red-600 focus-visible:outline-none focus-visible:shadow-[var(--pv-ring-focus)]"
      >
        Segnala problema
      </button>
    );
  }

  const handleConfirm = (): void => {
    setError(null);
    if (selected.length === 0) {
      setError('Seleziona almeno un veicolo');
      return;
    }
    startTransition(async () => {
      const res = await segnalaPraticaAction(praticaId, tipo, nota, selected);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setOpen(false);
      setNota('');
      toast('Segnalazione inviata', 'success');
      router.refresh();
    });
  };

  const toggle = (id: string): void => {
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-pv-navy-900/40 px-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-md rounded-[20px] bg-white p-6 shadow-[var(--pv-shadow-card-lg)]">
        <h2 className="text-[18px] font-extrabold text-pv-navy-900">
          Segnala un problema su questa pratica
        </h2>
        <p className="mt-1 text-[12.5px] text-pv-slate-500">
          Il team Passaggio Veloce verificherà la segnalazione. Se confermata,
          la pratica viene annullata e nessun fee ti sarà addebitato.
        </p>

        <div className="mt-4 space-y-3">
          {veicoli.length > 1 && (
            <fieldset className="block">
              <legend className="text-[12px] font-semibold text-pv-slate-700">
                Veicoli interessati
              </legend>
              <p className="mt-0.5 text-[11px] text-pv-slate-500">
                La penale a carico del broker è calcolata sui soli veicoli che
                selezioni.
              </p>
              <div className="mt-1.5 space-y-1.5">
                {veicoli.map((v) => (
                  <label
                    key={v.id}
                    className="flex cursor-pointer items-center gap-2.5 rounded-[10px] border-[1.5px] border-pv-slate-200 bg-pv-slate-50 px-3 py-2 transition-colors hover:bg-pv-slate-100"
                  >
                    <input
                      type="checkbox"
                      checked={selected.includes(v.id)}
                      onChange={() => toggle(v.id)}
                      className="h-4 w-4 shrink-0 accent-pv-navy-700"
                    />
                    <span className="text-[13px] font-semibold text-pv-navy-800">
                      {v.targa ?? 'Targa non indicata'}
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
          )}
          <label className="block">
            <span className="text-[12px] font-semibold text-pv-slate-700">
              Tipo problema
            </span>
            <select
              value={tipo}
              onChange={(e) => setTipo(e.target.value as SegnalazioneTipo)}
              className="mt-1 w-full rounded-[10px] border-[1.5px] border-pv-slate-300 px-3 py-2 text-[13px]"
            >
              {TIPI.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-[12px] font-semibold text-pv-slate-700">
              Nota per il team (opzionale)
            </span>
            <textarea
              value={nota}
              onChange={(e) => setNota(e.target.value)}
              maxLength={500}
              rows={4}
              placeholder="Aggiungi dettagli utili: data del fermo rilevato, ente che ha iscritto l'ipoteca, ecc."
              className="mt-1 w-full rounded-[10px] border-[1.5px] border-pv-slate-300 px-3 py-2 text-[13px]"
            />
            <span className="mt-1 block text-right text-[10px] text-pv-slate-500">
              {nota.length}/500
            </span>
          </label>
        </div>

        {error && (
          <div className="mt-3">
            <Alert variant="error">{error}</Alert>
          </div>
        )}

        <div className="mt-5 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <Button
            variant="secondary"
            onClick={() => setOpen(false)}
            disabled={pending}
          >
            Annulla
          </Button>
          <Button
            variant="danger"
            onClick={handleConfirm}
            disabled={pending}
            loading={pending}
            loadingLabel="Invio segnalazione…"
          >
            Invia segnalazione
          </Button>
        </div>
      </div>
      <LoadingOverlay show={pending} label="Invio segnalazione…" />
    </div>
  );
}
