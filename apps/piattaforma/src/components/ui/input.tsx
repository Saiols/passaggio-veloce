import type { InputHTMLAttributes } from 'react';
import { forwardRef } from 'react';
import { cn } from './cn';

type Props = InputHTMLAttributes<HTMLInputElement> & {
  invalid?: boolean;
};

const base =
  'block w-full rounded-[10px] px-[14px] py-3 text-sm font-medium text-pv-slate-900 ' +
  'placeholder:text-pv-slate-500 ' +
  'bg-pv-navy-100 border border-[1.5px] border-transparent ' +
  'transition-[background,border-color,box-shadow] duration-150 ease-out ' +
  'focus:bg-white focus:border-pv-navy-600 focus:shadow-[var(--pv-ring-focus)] focus:outline-none ' +
  'disabled:opacity-60 disabled:cursor-not-allowed';

const error =
  'border-pv-red-500 bg-pv-red-50/70 focus:border-pv-red-500 focus:shadow-[var(--pv-ring-error)]';

export const Input = forwardRef<HTMLInputElement, Props>(function Input(
  { className, invalid, 'aria-invalid': ariaInvalid, ...rest },
  ref,
) {
  const isInvalid = invalid ?? (ariaInvalid === true || ariaInvalid === 'true');
  return (
    <input
      ref={ref}
      aria-invalid={isInvalid || undefined}
      className={cn(base, isInvalid && error, className)}
      {...rest}
    />
  );
});
