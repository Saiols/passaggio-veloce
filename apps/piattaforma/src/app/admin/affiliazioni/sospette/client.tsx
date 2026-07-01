'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, Button } from '@/components/ui';
import { LoadingOverlay } from '@/components/ui/loading-overlay';
import { formatCurrencyCent } from '@/lib/format';
import {
  approveCommissioneAction,
  rejectCommissioneAction,
} from './actions';

type Item = {
  id: string;
  praticaCodice: string;
  praticaTarga: string | null;
  referenteRagioneSociale: string;
  referenteTipo: string;
  referralRagioneSociale: string;
  referralTipo: string | null;
  importoCent: number;
  flags: string[];
  flagsLabels: string[];
  createdAtIso: string;
  createdAtLabel: string;
};

export function SospetteClient({
  items,
  totale,
}: {
  items: Item[];
  totale: number;
}) {
  const router = useRouter();
  const [reviewing, setReviewing] = useState<{
    item: Item;
    mode: 'approve' | 'reject';
  } | null>(null);

  return (
    <div>
      <div className="mb-4 rounded-[12px] border-[1.5px] border-pv-orange-500/30 bg-pv-orange-50/30 px-4 py-3">
        <p className="text-[13px] font-bold text-pv-navy-900">
          ⚠️ {totale} commission{totale === 1 ? 'e' : 'i'} in attesa di review
        </p>
        <p className="text-[12px] text-pv-slate-700">
          Wallet del referente NON è ancora stato accreditato. La decisione è
          tracciata in audit log.
        </p>
      </div>

      <div className="space-y-3">
        {items.map((it) => (
          <div
            key={it.id}
            className="rounded-[12px] border-[1.5px] border-pv-amber-500/30 bg-white px-4 py-3"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-[14px] font-bold text-pv-navy-900">
                  Pratica {it.praticaCodice}
                  {it.praticaTarga && (
                    <span className="ml-2 text-pv-slate-500">
                      ({it.praticaTarga})
                    </span>
                  )}
                </p>
                <p className="mt-0.5 text-[12px] text-pv-slate-700">
                  <span className="font-semibold">{it.referralRagioneSociale}</span>{' '}
                  ({tipoLabel(it.referralTipo)}) →{' '}
                  <span className="font-semibold">{it.referenteRagioneSociale}</span>{' '}
                  ({tipoLabel(it.referenteTipo)})
                </p>
                <p className="mt-0.5 text-[10.5px] text-pv-slate-500">
                  Maturata {it.createdAtLabel} · Importo{' '}
                  {formatCurrencyCent(it.importoCent)}
                </p>
              </div>
              <div className="flex shrink-0 gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setReviewing({ item: it, mode: 'reject' })}
                >
                  Rifiuta
                </Button>
                <Button
                  size="sm"
                  onClick={() => setReviewing({ item: it, mode: 'approve' })}
                >
                  Approva
                </Button>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {it.flagsLabels.map((label) => (
                <span
                  key={label}
                  className="rounded-full bg-pv-amber-50 px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-wider text-pv-amber-500"
                >
                  ⚠ {label}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>

      {reviewing && (
        <ReviewModal
          item={reviewing.item}
          mode={reviewing.mode}
          onClose={() => setReviewing(null)}
          onDone={() => {
            setReviewing(null);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

function tipoLabel(tipo: string | null): string {
  if (tipo === 'DEALER') return 'broker';
  if (tipo === 'AGENZIA') return 'agenzia';
  return '—';
}

function ReviewModal({
  item,
  mode,
  onClose,
  onDone,
}: {
  item: Item;
  mode: 'approve' | 'reject';
  onClose: () => void;
  onDone: () => void;
}) {
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const submit = (): void => {
    setError(null);
    startTransition(async () => {
      const res =
        mode === 'approve'
          ? await approveCommissioneAction(item.id, note.trim() || undefined)
          : await rejectCommissioneAction(item.id, note.trim() || undefined);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      onDone();
    });
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-pv-navy-900/40 px-4 py-8"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-[16px] bg-white shadow-[var(--pv-shadow-card-lg)]"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-pv-slate-200 px-5 py-4">
          <h2 className="text-[16px] font-extrabold text-pv-navy-900">
            {mode === 'approve' ? 'Approva commissione' : 'Rifiuta commissione'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-[22px] leading-none text-pv-slate-500 hover:text-pv-navy-900"
            aria-label="Chiudi"
          >
            ×
          </button>
        </header>
        <div className="p-5">
          <p className="text-[13px] text-pv-slate-700">
            {mode === 'approve' ? (
              <>
                Confermi l&apos;accredito di{' '}
                <strong>{formatCurrencyCent(item.importoCent)}</strong> al
                wallet di <strong>{item.referenteRagioneSociale}</strong>?
              </>
            ) : (
              <>
                Confermi il rifiuto della commissione di{' '}
                <strong>{formatCurrencyCent(item.importoCent)}</strong>? Il
                wallet non sarà accreditato e la commissione resterà annullata.
              </>
            )}
          </p>
          <label className="mt-4 block">
            <span className="text-[11px] font-bold uppercase tracking-wider text-pv-slate-500">
              Nota (opzionale)
            </span>
            <textarea
              value={note}
              rows={3}
              maxLength={1000}
              onChange={(e) => setNote(e.target.value)}
              placeholder={
                mode === 'approve'
                  ? 'Es. verificato telefonicamente con il referente.'
                  : 'Es. confermato pattern di collusione, IBAN condiviso senza giustificazione.'
              }
              className="mt-1 w-full rounded-[10px] border-[1.5px] border-pv-slate-300 px-3 py-2 text-[13px]"
            />
          </label>
          {error && (
            <div className="mt-3">
              <Alert variant="error">{error}</Alert>
            </div>
          )}
          <div className="mt-5 flex justify-end gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={onClose}
              disabled={pending}
            >
              Annulla
            </Button>
            <Button
              variant={mode === 'approve' ? 'primary' : 'danger'}
              size="sm"
              onClick={submit}
              disabled={pending}
              loading={pending}
              loadingLabel={mode === 'approve' ? 'Accredito…' : 'Rifiuto…'}
            >
              {mode === 'approve' ? 'Approva e accredita' : 'Rifiuta'}
            </Button>
          </div>
        </div>
      </div>
      <LoadingOverlay
        show={pending}
        label={mode === 'approve' ? 'Accredito…' : 'Rifiuto…'}
      />
    </div>
  );
}
