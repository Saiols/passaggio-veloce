import type { ReactNode } from 'react';
import { Label } from './label';
import { cn } from './cn';

type Props = {
  label: string;
  required?: boolean;
  error?: string;
  hint?: string;
  htmlFor?: string;
  className?: string;
  children: ReactNode;
};

export function Field({ label, required, error, hint, htmlFor, className, children }: Props) {
  return (
    <div className={cn('min-w-0', className)}>
      <Label required={required} htmlFor={htmlFor}>
        {label}
      </Label>
      {children}
      {error ? (
        <p className="mt-1.5 text-xs font-medium text-pv-red-500">{error}</p>
      ) : hint ? (
        <p className="mt-1.5 text-xs text-pv-slate-500">{hint}</p>
      ) : null}
    </div>
  );
}
