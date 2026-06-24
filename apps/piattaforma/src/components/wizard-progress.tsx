import { cn } from '@/components/ui';

type Step = { id: number; label: string };

type Props = {
  steps: readonly Step[];
  current: number;
  label?: string;
  stickyOffset?: 'top-0' | 'top-14' | 'top-14 lg:top-0';
};

export function WizardProgress({
  steps,
  current,
  label = 'Registrazione',
  stickyOffset = 'top-14',
}: Props) {
  const clamped = Math.min(Math.max(current, 1), steps.length);
  const percent = ((clamped - 1) / (steps.length - 1)) * 100;

  return (
    <div className={`sticky ${stickyOffset} z-20 border-b border-pv-slate-200 bg-white/95 backdrop-blur`}>
      <div className="mx-auto w-full max-w-6xl px-5 pt-4 pb-3 sm:px-6">
        <div className="mb-2 flex items-baseline justify-between">
          <p className="text-[11px] font-bold uppercase tracking-wider text-pv-slate-500">
            {label}
          </p>
          <p className="text-[12px] font-semibold text-pv-slate-500">
            Step {clamped} di {steps.length}
          </p>
        </div>

        <div
          className="relative h-[6px] w-full overflow-hidden rounded-full bg-pv-slate-200"
          role="progressbar"
          aria-valuenow={clamped}
          aria-valuemin={1}
          aria-valuemax={steps.length}
          aria-label="Avanzamento registrazione"
        >
          <div
            className="h-full rounded-full bg-pv-navy-700 transition-[width] duration-300 ease-out"
            style={{ width: `${percent}%` }}
          />
        </div>

        <ol
          className="mt-2.5 grid gap-2 text-[11.5px] sm:text-[12px]"
          style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }}
        >
          {steps.map((s) => {
            const isDone = current > s.id;
            const isCurrent = current === s.id;
            return (
              <li
                key={s.id}
                className="flex min-w-0 items-center gap-1.5 truncate"
                aria-current={isCurrent ? 'step' : undefined}
              >
                <span
                  className={cn(
                    'flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full text-[10px] font-bold transition-colors',
                    isDone && 'bg-pv-navy-700 text-white',
                    isCurrent && 'bg-pv-orange-500 text-[#1a1a1a]',
                    !isDone && !isCurrent && 'bg-pv-slate-200 text-pv-slate-500',
                  )}
                >
                  {isDone ? '✓' : s.id}
                </span>
                <span
                  className={cn(
                    'truncate font-semibold',
                    isCurrent
                      ? 'text-pv-navy-800'
                      : isDone
                        ? 'text-pv-slate-700'
                        : 'text-pv-slate-500',
                  )}
                >
                  {s.label}
                </span>
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}
