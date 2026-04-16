import type { SelectHTMLAttributes } from 'react';
import { forwardRef } from 'react';
import { cn } from './cn';

type Props = SelectHTMLAttributes<HTMLSelectElement> & {
  invalid?: boolean;
};

const base =
  'block w-full appearance-none rounded-[10px] pl-[14px] pr-10 py-3 text-sm font-medium text-pv-slate-900 ' +
  'bg-pv-navy-100 border border-[1.5px] border-transparent ' +
  'transition-[background,border-color,box-shadow] duration-150 ease-out ' +
  'focus:bg-white focus:border-pv-navy-600 focus:shadow-[var(--pv-ring-focus)] focus:outline-none ' +
  'disabled:opacity-60 disabled:cursor-not-allowed';

const error =
  'border-pv-red-500 bg-pv-red-50/70 focus:border-pv-red-500 focus:shadow-[var(--pv-ring-error)]';

// Inline SVG chevron (slate-500)
const chevronUrl =
  "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20' fill='none' stroke='%2364748b' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><polyline points='6 8 10 12 14 8'/></svg>\")";

export const Select = forwardRef<HTMLSelectElement, Props>(function Select(
  { className, invalid, children, 'aria-invalid': ariaInvalid, style, ...rest },
  ref,
) {
  const isInvalid = invalid ?? (ariaInvalid === true || ariaInvalid === 'true');
  return (
    <select
      ref={ref}
      aria-invalid={isInvalid || undefined}
      className={cn(base, isInvalid && error, className)}
      style={{
        backgroundImage: chevronUrl,
        backgroundRepeat: 'no-repeat',
        backgroundPosition: 'right 14px center',
        backgroundSize: '18px 18px',
        ...style,
      }}
      {...rest}
    >
      {children}
    </select>
  );
});
