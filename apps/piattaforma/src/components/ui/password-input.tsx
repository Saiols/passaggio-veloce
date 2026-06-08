'use client';

import type { InputHTMLAttributes } from 'react';
import { forwardRef, useState } from 'react';
import { cn } from './cn';

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & {
  invalid?: boolean;
  /** Classi sul wrapper relativo (utile per col-span in griglia, margini, ecc.). */
  containerClassName?: string;
};

// Stile di default = identico al componente <Input> del design system,
// ma con `pr-11` al posto di `px-[14px]` per lasciare spazio all'icona occhio.
const base =
  'block w-full rounded-[10px] pl-[14px] pr-11 py-3 text-sm font-medium text-pv-slate-900 ' +
  'placeholder:text-pv-slate-500 ' +
  'bg-pv-navy-100 border border-[1.5px] border-transparent ' +
  'transition-[background,border-color,box-shadow] duration-150 ease-out ' +
  'focus:bg-white focus:border-pv-navy-600 focus:shadow-[var(--pv-ring-focus)] focus:outline-none ' +
  'disabled:opacity-60 disabled:cursor-not-allowed';

const errorCls =
  'border-pv-red-500 bg-pv-red-50/70 focus:border-pv-red-500 focus:shadow-[var(--pv-ring-error)]';

function EyeIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-[18px] w-[18px]"
      aria-hidden="true"
    >
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-[18px] w-[18px]"
      aria-hidden="true"
    >
      <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
      <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c6.5 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
      <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3.5 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
      <line x1="2" x2="22" y1="2" y2="22" />
    </svg>
  );
}

/**
 * Campo password con toggle mostra/nascondi (icona occhio a destra).
 *
 * - Senza `className`: usa lo stile del design system (identico a <Input>).
 * - Con `className`: usa lo stile passato (per i form con look proprio) e
 *   aggiunge solo `pr-10` per non far finire il testo sotto l'icona.
 */
export const PasswordInput = forwardRef<HTMLInputElement, Props>(function PasswordInput(
  { className, containerClassName, invalid, 'aria-invalid': ariaInvalid, ...rest },
  ref,
) {
  const [show, setShow] = useState(false);
  const isInvalid = invalid ?? (ariaInvalid === true || ariaInvalid === 'true');

  return (
    <div className={cn('relative', containerClassName)}>
      <input
        ref={ref}
        type={show ? 'text' : 'password'}
        aria-invalid={isInvalid || undefined}
        className={className ? cn(className, 'pr-10') : cn(base, isInvalid && errorCls)}
        {...rest}
      />
      <button
        type="button"
        onClick={() => setShow((s) => !s)}
        aria-label={show ? 'Nascondi password' : 'Mostra password'}
        aria-pressed={show}
        title={show ? 'Nascondi password' : 'Mostra password'}
        className={cn(
          'absolute inset-y-0 right-0 flex items-center pl-2 pr-3',
          'text-pv-slate-500 transition-colors hover:text-pv-navy-700',
          'focus:outline-none focus-visible:text-pv-navy-700',
        )}
      >
        {show ? <EyeOffIcon /> : <EyeIcon />}
      </button>
    </div>
  );
});
