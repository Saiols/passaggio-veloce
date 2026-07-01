'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, Button } from '@/components/ui';
import { LoadingOverlay } from '@/components/ui/loading-overlay';
import {
  richiediRevisioneManualeAction,
  type MotivoRevisione,
} from '@/lib/documenti/revisione';

const MOTIVI: { value: MotivoRevisione; label: string }[] = [
  { value: 'DOCUMENTO_NON_STANDARD', label: 'Documento non standard (es. atto giudiziario, certificato particolare)' },
  { value: 'CASO_NON_PREVISTO_DA_SCHEMA', label: 'Caso non previsto dallo schema documentale' },
  { value: 'RICHIESTA_BROKER', label: 'Altra situazione che richiede chiarimenti' },
];

/**
 * Schema Documentale v7 (SD-C release 2026-05): popup attivabile dal
 * wizard pratica per chiedere review manuale al team PV.
 *
 * Il broker descrive la situazione (min 20 char), il team riceve email
 * N20 e si attiva entro 24-48h. La pratica resta in BOZZA.
 */
export function RevisioneManualePopup({
  praticaId,
  open,
  onClose,
}: {
  praticaId: string | null;
  open: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const [motivo, setMotivo] = useState<MotivoRevisione>('DOCUMENTO_NON_STANDARD');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [pending, startTransition] = useTransition();

  if (!open) return null;

  const handleSubmit = (): void => {
    setError(null);
    startTransition(async () => {
      const res = await richiediRevisioneManualeAction(praticaId, motivo, note);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setSuccess(true);
      router.refresh();
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-pv-navy-900/40 px-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-lg rounded-[20px] bg-white p-6 shadow-[var(--pv-shadow-card-lg)]">
        {success ? (
          <>
            <h2 className="text-[18px] font-extrabold text-pv-green-500">
              Revisione richiesta ✓
            </h2>
            <p className="mt-2 text-[13px] text-pv-slate-700">
              Il nostro team ha ricevuto la richiesta. Ti contatteremo via
              email entro 24-48 ore con istruzioni precise sui documenti
              necessari per la tua situazione.
            </p>
            <p className="mt-2 text-[12.5px] text-pv-slate-500">
              La pratica è salvata come bozza. Non serve fare altro.
            </p>
            <div className="mt-5 flex justify-end">
              <Button onClick={onClose}>Chiudi</Button>
            </div>
          </>
        ) : (
          <>
            <h2 className="text-[18px] font-extrabold text-pv-navy-900">
              Non trovi la tua situazione?
            </h2>
            <p className="mt-2 text-[13px] text-pv-slate-700">
              Salviamo la pratica come bozza e il nostro team la analizza
              manualmente entro <strong>24-48 ore</strong>. Ti contatteremo
              via email con istruzioni precise sui documenti necessari.
            </p>

            <div className="mt-4 space-y-3">
              <label className="block">
                <span className="text-[12px] font-semibold text-pv-slate-700">
                  Tipo
                </span>
                <select
                  value={motivo}
                  onChange={(e) => setMotivo(e.target.value as MotivoRevisione)}
                  className="mt-1 w-full rounded-[10px] border-[1.5px] border-pv-slate-300 px-3 py-2 text-[13px]"
                >
                  {MOTIVI.map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="text-[12px] font-semibold text-pv-slate-700">
                  Descrivi la situazione (min 20, max 1000 char)
                </span>
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  maxLength={1000}
                  rows={5}
                  placeholder="Es. Il proprietario è defunto e gli eredi sono 4 fratelli, di cui uno residente all'estero. Quali documenti servono?"
                  className="mt-1 w-full rounded-[10px] border-[1.5px] border-pv-slate-300 px-3 py-2 text-[13px]"
                />
                <span className="mt-1 block text-right text-[10px] text-pv-slate-500">
                  {note.length}/1000
                </span>
              </label>
            </div>

            {error && (
              <div className="mt-3">
                <Alert variant="error">{error}</Alert>
              </div>
            )}

            <div className="mt-5 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <Button variant="secondary" onClick={onClose} disabled={pending}>
                Annulla
              </Button>
              <Button
                onClick={handleSubmit}
                disabled={pending || note.trim().length < 20}
                loading={pending}
                loadingLabel="Invio…"
              >
                Salva e richiedi revisione
              </Button>
            </div>
          </>
        )}
      </div>
      <LoadingOverlay show={pending} label="Invio…" />
    </div>
  );
}
