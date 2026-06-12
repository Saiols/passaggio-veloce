'use client';

import { useState, useTransition } from 'react';
import { InlineSpinner } from '@/components/ui';
import {
  reactivateCompanyAction,
  reactivateUserAction,
  suspendCompanyAction,
  suspendUserAction,
} from './suspension-actions';

type Target = { kind: 'user' | 'company'; id: string };

export function SuspendButton({
  target,
  suspended,
}: {
  target: Target;
  suspended: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [dialog, setDialog] = useState<'suspend' | 'reactivate' | null>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  const open = (mode: 'suspend' | 'reactivate'): void => {
    setError(null);
    setNote('');
    setDialog(mode);
  };

  const submit = (): void => {
    setError(null);
    startTransition(async () => {
      const trimmed = note.trim();
      const optionalNote = trimmed || undefined;
      let res: { ok: true } | { ok: false; error: string };
      if (target.kind === 'user') {
        res =
          dialog === 'reactivate'
            ? await reactivateUserAction(target.id)
            : await suspendUserAction(target.id);
      } else {
        res =
          dialog === 'reactivate'
            ? await reactivateCompanyAction(target.id, optionalNote)
            : await suspendCompanyAction(target.id, optionalNote);
      }
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setDialog(null);
    });
  };

  return (
    <>
      <button
        type="button"
        onClick={() => open(suspended ? 'reactivate' : 'suspend')}
        disabled={pending}
        className={
          suspended
            ? 'rounded-[8px] border border-pv-green-500/40 bg-pv-green-50 px-3 py-1 text-[12px] font-semibold text-pv-green-500 hover:brightness-95 disabled:opacity-50'
            : 'rounded-[8px] border border-pv-red-500/40 bg-pv-red-50 px-3 py-1 text-[12px] font-semibold text-pv-red-500 hover:brightness-95 disabled:opacity-50'
        }
      >
        {pending ? '...' : suspended ? 'Riattiva' : 'Sospendi'}
      </button>

      {dialog && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-pv-navy-900/40 px-4 py-8"
          onClick={() => !pending && setDialog(null)}
        >
          <div
            className="w-full max-w-md rounded-[16px] bg-white shadow-[var(--pv-shadow-card-lg)]"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="flex items-center justify-between border-b border-pv-slate-200 px-5 py-4">
              <h2 className="text-[16px] font-extrabold text-pv-navy-900">
                {dialog === 'reactivate'
                  ? 'Riattiva account'
                  : target.kind === 'company'
                    ? "Sospendi azienda"
                    : 'Sospendi utente'}
              </h2>
              <button
                type="button"
                onClick={() => !pending && setDialog(null)}
                className="text-[22px] leading-none text-pv-slate-500 hover:text-pv-navy-900"
                aria-label="Chiudi"
              >
                ×
              </button>
            </header>

            <div className="p-5">
              <p className="text-[13px] text-pv-slate-700">
                {dialog === 'reactivate' ? (
                  <>
                    L&apos;account torna <strong>ACTIVE</strong>. Email N15 di
                    riattivazione inviata a tutti gli utenti aziendali.
                  </>
                ) : target.kind === 'company' ? (
                  <>
                    Sospendere l&apos;azienda? Tutti gli utenti aziendali
                    verranno marcati <strong>SUSPENDED</strong> e non potranno
                    più accedere. Email N14 verrà inviata.
                  </>
                ) : (
                  <>
                    L&apos;utente non potrà più accedere alla piattaforma
                    finché non viene riattivato.
                  </>
                )}
              </p>

              {target.kind === 'company' && (
                <label className="mt-4 block">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-pv-slate-500">
                    Nota motivazione (opzionale)
                  </span>
                  <textarea
                    value={note}
                    rows={3}
                    maxLength={1000}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder={
                      dialog === 'reactivate'
                        ? 'Es. KYC completato, ripristino accesso.'
                        : 'Es. mancata risposta segnalazioni, sospensione cautelare.'
                    }
                    className="mt-1 w-full rounded-[10px] border-[1.5px] border-pv-slate-300 px-3 py-2 text-[13px]"
                  />
                  <p className="mt-1 text-[11px] text-pv-slate-500">
                    Salvata sull&apos;audit trail della company e inclusa nell&apos;email.
                  </p>
                </label>
              )}

              {error && (
                <p className="mt-3 rounded-[8px] bg-pv-red-50 px-3 py-2 text-[12.5px] text-pv-red-500">
                  {error}
                </p>
              )}

              <div className="mt-5 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setDialog(null)}
                  disabled={pending}
                  className="rounded-[10px] border-[1.5px] border-pv-slate-300 px-3 py-1.5 text-[13px] font-semibold text-pv-slate-700 hover:bg-pv-slate-50 disabled:opacity-50"
                >
                  Annulla
                </button>
                <button
                  type="button"
                  onClick={submit}
                  disabled={pending}
                  aria-busy={pending || undefined}
                  className={
                    'inline-flex items-center justify-center gap-2 rounded-[10px] px-3 py-1.5 text-[13px] font-semibold text-white disabled:opacity-50 ' +
                    (dialog === 'reactivate'
                      ? 'bg-pv-green-500 hover:brightness-95'
                      : 'bg-pv-red-500 hover:brightness-95')
                  }
                >
                  {pending && <InlineSpinner className="h-4 w-4" />}
                  <span>
                    {pending
                      ? dialog === 'reactivate'
                        ? 'Riattivazione…'
                        : 'Sospensione…'
                      : dialog === 'reactivate'
                        ? 'Riattiva'
                        : 'Sospendi'}
                  </span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
