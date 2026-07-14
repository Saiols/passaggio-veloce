'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, Button, Modal } from '@/components/ui';
import { LoadingOverlay } from '@/components/ui/loading-overlay';
import { registraOpposizioneCatalogoAction } from './actions';

/**
 * GDPR art. 21 — registra l'opposizione al trattamento su un contatto del
 * catalogo (F-05). Conferma in modale graficata (non window.confirm): è
 * un'azione che esclude il contatto dal catalogo e dall'export CSV finché
 * non viene revocata, quindi merita un passaggio deliberato con una nota
 * facoltativa (es. estremi della richiesta arrivata a privacy@).
 */
export function OpposizioneCatalogoButton({
  chiave,
  nominativo,
}: {
  chiave: string;
  nominativo: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const close = (): void => {
    if (pending) return;
    setOpen(false);
    setError(null);
    setNote('');
  };

  const handleConfirm = (): void => {
    setError(null);
    startTransition(async () => {
      const res = await registraOpposizioneCatalogoAction(chiave, note);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setOpen(false);
      setNote('');
      router.refresh();
    });
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-[12px] font-semibold text-pv-red-500 hover:underline"
      >
        Registra opposizione
      </button>

      <Modal
        open={open}
        onClose={close}
        title="Registrare l'opposizione (art. 21 GDPR)?"
        description={`${nominativo} verrà escluso dal catalogo contatti — export CSV incluso — fino a eventuale revoca.`}
        size="sm"
      >
        <div className="space-y-3">
          <label className="block">
            <span className="text-[12px] font-semibold text-pv-slate-700">
              Note (facoltativo — es. estremi della richiesta a privacy@)
            </span>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={1000}
              rows={3}
              placeholder="Es. Richiesta ricevuta il 14/07/2026 via privacy@passaggioveloce.it"
              className="mt-1 w-full rounded-[10px] border-[1.5px] border-pv-slate-300 px-3 py-2 text-[13px]"
            />
          </label>

          {error && <Alert variant="error">{error}</Alert>}

          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <Button type="button" variant="secondary" onClick={close} disabled={pending}>
              Annulla
            </Button>
            <Button
              type="button"
              variant="danger"
              onClick={handleConfirm}
              disabled={pending}
              loading={pending}
              loadingLabel="Registrazione…"
            >
              Registra opposizione
            </Button>
          </div>
        </div>
      </Modal>
      <LoadingOverlay show={pending} label="Registrazione…" />
    </>
  );
}
