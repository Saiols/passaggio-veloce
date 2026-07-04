'use client';

import { formatCurrencyCent } from '@/lib/format';
import { LoadingOverlay } from '@/components/ui/loading-overlay';
import type { VocePayout } from '@/lib/wallet/breakdown';

export type WalletPreview = {
  origine: 'sede' | 'madre';
  willPay: boolean;
  saldoCent: number;
  voci: VocePayout[];
};

function labelVoce(tipo: string): string {
  switch (tipo) {
    case 'CREDITO_PRATICA':
      return 'Compensi pratiche firmate';
    case 'CREDITO_AFFILIAZIONE':
      return 'Commissioni di affiliazione';
    case 'CREDITO_PROMO':
      return 'Bonus welcome (codice promozionale)';
    case 'PENALE_BROKER':
      return 'Penali segnalazioni';
    case 'RETTIFICA_ADMIN':
      return 'Rettifiche';
    case 'STORNO':
      return 'Storni';
    default:
      return 'Altre voci';
  }
}

function labelOrigine(origine: 'sede' | 'madre'): string {
  return origine === 'madre'
    ? 'Commissioni di affiliazione'
    : 'Compensi pratiche / bonus';
}

/** Somma le voci per tipo su più wallet, mantenendo l'ordine per importo. */
function mergeVoci(wallets: WalletPreview[]): VocePayout[] {
  const map = new Map<string, number>();
  for (const w of wallets) {
    for (const v of w.voci) {
      map.set(v.tipo, (map.get(v.tipo) ?? 0) + v.importoCent);
    }
  }
  return [...map.entries()]
    .map(([tipo, importoCent]) => ({ tipo, importoCent }))
    .filter((v) => v.importoCent !== 0)
    .sort((a, b) => b.importoCent - a.importoCent);
}

export function PayoutConfirmModal({
  open,
  onClose,
  onConfirm,
  pending,
  error,
  wallets,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  pending: boolean;
  error: string | null;
  wallets: WalletPreview[];
}) {
  if (!open) return null;

  const pagabili = wallets.filter((w) => w.willPay);
  const attesa = wallets.filter((w) => !w.willPay && w.saldoCent > 0);
  const totalePagabileCent = pagabili.reduce((s, w) => s + w.saldoCent, 0);
  const voci = mergeVoci(pagabili);
  const hasBonus = voci.some((v) => v.tipo === 'CREDITO_PROMO');

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/40 p-4">
      <div className="max-h-[90vh] w-full max-w-lg overflow-auto rounded-2xl bg-white p-6 shadow-xl">
        <h2 className="text-[18px] font-bold text-pv-navy-900">
          Conferma richiesta payout
        </h2>
        <p className="mt-2 text-[13px] text-pv-slate-600">
          Stai per richiedere il payout del saldo disponibile. L&apos;importo verrà
          erogato tramite bonifico sull&apos;IBAN registrato. Ecco da cosa è composto:
        </p>

        {/* Dettaglio per origine */}
        <div className="mt-4 rounded-xl border border-pv-slate-200 bg-pv-slate-50 p-4">
          <ul className="divide-y divide-pv-slate-200 text-[13px]">
            {voci.map((v) => (
              <li
                key={v.tipo}
                className="flex items-center justify-between gap-3 py-2"
              >
                <span className="text-pv-slate-700">{labelVoce(v.tipo)}</span>
                <span
                  className={`font-semibold tabular-nums ${
                    v.importoCent >= 0 ? 'text-pv-navy-800' : 'text-pv-red-500'
                  }`}
                >
                  {v.importoCent >= 0 ? '' : '−'}
                  {formatCurrencyCent(Math.abs(v.importoCent))}
                </span>
              </li>
            ))}
          </ul>
          <div className="mt-3 flex items-center justify-between border-t border-pv-slate-300 pt-3">
            <span className="text-[13px] font-bold text-pv-navy-900">
              Totale payout
            </span>
            <span className="text-[16px] font-extrabold tabular-nums text-pv-navy-900">
              {formatCurrencyCent(totalePagabileCent)}
            </span>
          </div>
        </div>

        {hasBonus && (
          <p className="mt-3 text-[12px] text-pv-slate-500">
            Il bonus welcome viene erogato insieme al saldo. Il documento fiscale
            riporta i soli compensi da pratiche e affiliazione.
          </p>
        )}

        {attesa.length > 0 && (
          <div className="mt-3 rounded-lg bg-pv-amber-50 p-3 text-[12.5px] text-pv-slate-600">
            <p className="font-semibold text-pv-amber-500">
              Non inclusi in questo payout (sotto soglia)
            </p>
            <ul className="mt-1 space-y-0.5">
              {attesa.map((w) => (
                <li key={w.origine} className="flex justify-between gap-3">
                  <span>{labelOrigine(w.origine)}</span>
                  <span className="tabular-nums">
                    {formatCurrencyCent(w.saldoCent)}
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-1 text-pv-slate-500">
              Resteranno nel wallet e matureranno fino al raggiungimento della
              soglia minima.
            </p>
          </div>
        )}

        {error && <p className="mt-3 text-[13px] text-pv-red-500">{error}</p>}

        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            className="rounded-lg px-4 py-2 text-sm font-semibold text-pv-slate-600 disabled:opacity-50"
          >
            Annulla
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={pending || totalePagabileCent <= 0}
            className="rounded-lg bg-pv-navy-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {pending ? 'Eseguo…' : 'Conferma payout'}
          </button>
        </div>
      </div>
      <LoadingOverlay show={pending} label="Elaborazione payout…" />
    </div>
  );
}
