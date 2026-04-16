import type { LabelHTMLAttributes, ReactNode } from 'react';
import { cn } from './cn';

type Props = LabelHTMLAttributes<HTMLLabelElement> & {
  required?: boolean;
  children: ReactNode;
};

export function Label({ required, className, children, ...rest }: Props) {
  return (
    <label
      className={cn('mb-1.5 block text-[12.5px] font-semibold text-pv-slate-700', className)}
      {...rest}
    >
      {children}
      {required && (
        <span aria-hidden="true" className="ml-1 text-pv-orange-500">
          •
        </span>
      )}
    </label>
  );
}
