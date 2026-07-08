'use client';

import { useState, useTransition } from 'react';
import { Alert, Button } from '@/components/ui';
import { LoadingOverlay } from '@/components/ui/loading-overlay';
import { inviaSegnalazioneCreazioneAction } from '@/lib/segnalazioni/creazione';
import type { TipoProblemaSegnalazione } from '@pv/db';
import type { BlobRefInput } from '@/lib/segnalazioni/snapshot';

const TIPI: { value: TipoProblemaSegnalazione; label: string }[] = [
  { value: 'LETTURA_DATI', label: 'Un dato è stato letto/precompilato male' },
  { value: 'COMPILAZIONE', label: 'Non so come compilare un campo o un caso' },
  { value: 'ALTRO', label: 'Altro problema' },
];

/** Snapshot NON validato dello stato corrente del wizard, costruito dalla
 *  stessa logica usata per il submit (vedi wizard.tsx: buildVeicoliSnapshot
 *  e affini). */
type SegnalazionePayload = {
  tipoPratica: string;
  veicoli: unknown;
  venditori: unknown;
  acquirente: unknown;
  coAcquirenti: unknown;
  blobRefs: Record<string, BlobRefInput>;
  brokerSedeId: string | null;
};

/**
 * Popup "segnala un problema" attivabile da una CTA discreta in ogni step del
 * wizard "nuova pratica". NON crea né tocca la pratica: invia uno snapshot
 * best-effort dello stato corrente (dati grezzi, anche parziali) al team PV,
 * che risponde via email. Il broker resta nel wizard con i dati intatti
 * (nessun refresh/navigazione).
 */
export function SegnalaProblemaPopup({
  open,
  onClose,
  step,
  buildPayload,
}: {
  open: boolean;
  onClose: () => void;
  /** Step corrente del wizard (1..4): salvato sulla segnalazione. */
  step: number;
  /** Closure che costruisce lo snapshot corrente (nessuna validazione). */
  buildPayload: () => SegnalazionePayload;
}) {
  const [tipo, setTipo] = useState<TipoProblemaSegnalazione>('LETTURA_DATI');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [pending, startTransition] = useTransition();

  if (!open) return null;

  const handleSubmit = (): void => {
    setError(null);
    startTransition(async () => {
      const payload = buildPayload();
      const res = await inviaSegnalazioneCreazioneAction({
        step,
        tipo,
        descrizione: note,
        datiGrezzi: {
          tipo: payload.tipoPratica,
          veicoli: payload.veicoli,
          venditori: payload.venditori,
          acquirente: payload.acquirente,
          coAcquirenti: payload.coAcquirenti,
        },
        blobRefs: payload.blobRefs,
        brokerSedeId: payload.brokerSedeId,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setSuccess(true);
    });
  };

  const handleClose = (): void => {
    // Reset per il prossimo utilizzo (il popup resta montato nel wizard).
    setSuccess(false);
    setError(null);
    setNote('');
    setTipo('LETTURA_DATI');
    onClose();
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
              Segnalazione inviata ✓
            </h2>
            <p className="mt-2 text-[13px] text-pv-slate-700">
              Grazie, ti risponderemo via email. Puoi continuare la
              compilazione.
            </p>
            <div className="mt-5 flex justify-end">
              <Button onClick={handleClose}>Chiudi</Button>
            </div>
          </>
        ) : (
          <>
            <h2 className="text-[18px] font-extrabold text-pv-navy-900">
              Hai riscontrato un problema?
            </h2>
            <p className="mt-2 text-[13px] text-pv-slate-700">
              Segnalaci cosa non torna: inviamo al nostro team lo stato
              attuale della compilazione (dati e documenti caricati finora).
              Nessun dato viene toccato: puoi continuare la pratica subito
              dopo l&apos;invio.
            </p>

            <div className="mt-4 space-y-3">
              <label className="block">
                <span className="text-[12px] font-semibold text-pv-slate-700">
                  Tipo
                </span>
                <select
                  value={tipo}
                  onChange={(e) => setTipo(e.target.value as TipoProblemaSegnalazione)}
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
                  Descrivi la situazione (min 20, max 1000 char)
                </span>
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  maxLength={1000}
                  rows={5}
                  placeholder="Es. La targa letta dall'OCR non corrisponde a quella sul libretto caricato."
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
              <Button variant="secondary" onClick={handleClose} disabled={pending}>
                Annulla
              </Button>
              <Button
                onClick={handleSubmit}
                disabled={pending || note.trim().length < 20}
                loading={pending}
                loadingLabel="Invio…"
              >
                Invia segnalazione
              </Button>
            </div>
          </>
        )}
      </div>
      <LoadingOverlay show={pending} label="Invio…" />
    </div>
  );
}
