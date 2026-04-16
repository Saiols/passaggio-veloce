import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from './cn';

type Props = HTMLAttributes<HTMLDivElement> & {
  children: ReactNode;
  padded?: boolean;
};

export function Card({ className, children, padded = true, ...rest }: Props) {
  return (
    <div
      className={cn(
        'rounded-[16px] border border-pv-slate-200 bg-white shadow-[var(--pv-shadow-card)]',
        padded && 'p-5 sm:p-6',
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}
