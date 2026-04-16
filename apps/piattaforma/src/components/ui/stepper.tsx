import { cn } from './cn';

type Step = { id: number; label: string };

type Props = {
  steps: readonly Step[];
  current: number;
};

export function Stepper({ steps, current }: Props) {
  return (
    <ol className="flex items-start gap-1 text-[11px] sm:text-xs" aria-label="Avanzamento registrazione">
      {steps.map((s, idx) => {
        const isDone = current > s.id;
        const isCurrent = current === s.id;
        const isLast = idx === steps.length - 1;
        return (
          <li
            key={s.id}
            className="flex min-w-0 flex-1 flex-col items-center gap-1.5 sm:flex-row sm:gap-2"
            aria-current={isCurrent ? 'step' : undefined}
          >
            <div className="flex w-full items-center">
              <div
                className={cn(
                  'flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold transition-colors',
                  isDone &&
                    'bg-pv-green-500 text-white shadow-[0_2px_6px_rgb(22_163_74_/_0.35)]',
                  isCurrent &&
                    'bg-pv-navy-700 text-white shadow-[0_0_0_4px_rgb(0_84_166_/_0.20)]',
                  !isDone && !isCurrent && 'bg-pv-slate-200 text-pv-slate-500',
                )}
              >
                {isDone ? '✓' : s.id}
              </div>
              {!isLast && (
                <div
                  className={cn(
                    'mx-1 h-[3px] flex-1 rounded-full transition-colors sm:mx-2',
                    isDone ? 'bg-pv-green-500' : 'bg-pv-slate-200',
                  )}
                />
              )}
            </div>
            <span
              className={cn(
                'truncate text-center sm:text-left',
                isCurrent
                  ? 'font-semibold text-pv-navy-700'
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
  );
}
