import type { ReactNode } from 'react';
import type { GuidaStepResult } from '@/lib/pratiche/guida-step';

/** Stepper + card "prossimo passo". `cta` è lo slot dell'azione primaria. */
export function GuidaStepCard({
  guida,
  cta,
}: {
  guida: GuidaStepResult;
  cta?: ReactNode;
}) {
  const accent =
    guida.variant === 'azione'
      ? 'border-l-pv-orange-500'
      : guida.chiusaNegativa
        ? 'border-l-pv-red-500'
        : 'border-l-pv-slate-300';
  const label =
    guida.variant === 'azione'
      ? 'Prossimo passo'
      : guida.variant === 'attesa'
        ? 'In corso'
        : 'Stato';
  const labelColor =
    guida.variant === 'azione' ? 'text-pv-orange-500' : 'text-pv-slate-500';

  return (
    <div className="mb-6">
      <ol className="mb-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] font-semibold">
        {guida.steps.map((s, i) => (
          <li key={s.key} className="flex items-center gap-2">
            {i > 0 && <span className="text-pv-slate-300">›</span>}
            <span
              className={
                s.stato === 'done'
                  ? 'text-pv-green-500'
                  : s.stato === 'current'
                    ? 'rounded-full border border-pv-orange-500 bg-[color-mix(in_srgb,#ff7a00_8%,white)] px-2 py-0.5 text-pv-navy-900'
                    : 'text-pv-slate-400'
              }
            >
              {s.stato === 'done' ? '✓ ' : s.stato === 'current' ? '● ' : ''}
              {s.label}
            </span>
          </li>
        ))}
      </ol>
      <div
        className={`flex flex-col gap-3 rounded-[12px] border border-pv-slate-200 border-l-4 bg-white p-4 shadow-[var(--pv-shadow-card)] sm:flex-row sm:items-center ${accent}`}
      >
        <div className="min-w-0 flex-1">
          <p className={`text-[10px] font-bold uppercase tracking-wider ${labelColor}`}>
            {label}
          </p>
          <p className="mt-1 text-[15px] font-extrabold text-pv-navy-900">
            {guida.titolo}
          </p>
          <p className="mt-0.5 text-[12.5px] text-pv-slate-500">{guida.descrizione}</p>
        </div>
        {guida.variant === 'azione' && cta && (
          // CTA "prossimo passo": dimensioni fisse. Le varianti [&_button] hanno
          // specificità maggiore (.classe button) → sovrascrivono il font-size
          // del size del Button anche senza tailwind-merge.
          <div className="shrink-0 [&_button]:h-[45px] [&_button]:min-w-[180px] [&_button]:text-[16px]">
            {cta}
          </div>
        )}
      </div>
    </div>
  );
}
