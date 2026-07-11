'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, Button } from '@/components/ui';
import { LoadingOverlay } from '@/components/ui/loading-overlay';
import { formatCurrencyCent } from '@/lib/format';
import {
  confermaAnnullamentoConPenaleAction,
  respingiSegnalazioneAction,
} from '@/lib/penali/segnalazione';

/**
 * Sistema Penali Broker — SP-B: form admin per gestire una segnalazione
 * pendente (RICEVUTA). Due azioni: conferma → annulla pratica + addebita
 * penale broker (€25 per ciascun veicolo segnalato, calcolata dal chiamante
 * con `calcolaPenaleBrokerCent` — stessa regola del server action); respingi
 * → segnalazione annullata, pratica torna live.
 */
export function GestioneSegnalazione({
  praticaId,
  importoPenaleCent,
}: {
  praticaId: string;
  /** Importo reale della penale per QUESTA pratica (già €25 × veicoli segnalati). */
  importoPenaleCent: number;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [respingiOpen, setRespingiOpen] = useState(false);
  const [motivoRespinta, setMotivoRespinta] = useState('');

  const handleConferma = (): void => {
    if (
      !confirm(
        `Confermi annullamento + addebito penale ${formatCurrencyCent(importoPenaleCent)} al broker? Operazione non reversibile.`,
      )
    ) {
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await confermaAnnullamentoConPenaleAction(praticaId);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.refresh();
    });
  };

  const handleRespingi = (): void => {
    setError(null);
    startTransition(async () => {
      const res = await respingiSegnalazioneAction(praticaId, motivoRespinta);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.refresh();
    });
  };

  if (respingiOpen) {
    return (
      <div className="space-y-3">
        <label className="block">
          <span className="text-[12px] font-semibold text-pv-slate-700">
            Motivo del respingimento (max 500 char)
          </span>
          <textarea
            value={motivoRespinta}
            onChange={(e) => setMotivoRespinta(e.target.value)}
            maxLength={500}
            rows={3}
            placeholder="Es. Visura PRA verificata, nessun fermo attivo. Pratica torna in lavorazione."
            className="mt-1 w-full rounded-[10px] border-[1.5px] border-pv-slate-300 px-3 py-2 text-[13px]"
          />
        </label>
        {error && <Alert variant="error">{error}</Alert>}
        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              setRespingiOpen(false);
              setError(null);
            }}
            disabled={pending}
          >
            Indietro
          </Button>
          <Button
            type="button"
            onClick={handleRespingi}
            disabled={pending || !motivoRespinta.trim()}
            loading={pending}
            loadingLabel="Respingo…"
          >
            Conferma respingimento
          </Button>
        </div>
        <LoadingOverlay show={pending} label="Respingimento…" />
      </div>
    );
  }

  return (
    <div>
      {error && (
        <div className="mb-3">
          <Alert variant="error">{error}</Alert>
        </div>
      )}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-end">
        <Button
          type="button"
          variant="secondary"
          onClick={() => setRespingiOpen(true)}
          disabled={pending}
        >
          Respingi segnalazione
        </Button>
        <Button
          type="button"
          variant="danger"
          onClick={handleConferma}
          disabled={pending}
          loading={pending}
          loadingLabel="In corso…"
        >
          Conferma annullo + addebita penale
        </Button>
      </div>
      <LoadingOverlay show={pending} label="Attendere…" />
    </div>
  );
}
