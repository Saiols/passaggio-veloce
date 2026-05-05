'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, Button } from '@/components/ui';
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
export function SegnalaProblemaButton({ praticaId }: { praticaId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [tipo, setTipo] = useState<SegnalazioneTipo>('FERMO_AMMINISTRATIVO');
  const [nota, setNota] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!open) {
    return (
      <Button
        type="button"
        size="sm"
        variant="danger"
        onClick={() => {
          setOpen(true);
          setError(null);
        }}
      >
        Segnala problema
      </Button>
    );
  }

  const handleConfirm = (): void => {
    setError(null);
    startTransition(async () => {
      const res = await segnalaPraticaAction(praticaId, tipo, nota);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setOpen(false);
      setNota('');
      router.refresh();
    });
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
    </div>
  );
}
