import type { InputHTMLAttributes } from 'react';
import { forwardRef } from 'react';
import { cn } from './cn';

type Props = InputHTMLAttributes<HTMLInputElement>;

export const Checkbox = forwardRef<HTMLInputElement, Props>(function Checkbox(
  { className, ...rest },
  ref,
) {
  return (
    <input
      ref={ref}
      type="checkbox"
      className={cn(
        'h-[18px] w-[18px] shrink-0 rounded-[4px] border-[1.5px] border-pv-slate-300 accent-pv-navy-700',
        'focus-visible:outline-none focus-visible:shadow-[var(--pv-ring-focus)]',
        'disabled:cursor-not-allowed disabled:opacity-60',
        className,
      )}
      {...rest}
    />
  );
});
