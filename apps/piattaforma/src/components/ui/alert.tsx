import type { ReactNode } from 'react';
import { cn } from './cn';

type Variant = 'success' | 'error' | 'warning' | 'info';

type Props = {
  variant?: Variant;
  title?: string;
  children: ReactNode;
  className?: string;
};

const variants: Record<Variant, { box: string; icon: string; path: ReactNode }> = {
  success: {
    box: 'border-pv-green-500/30 bg-pv-green-50 text-[color:var(--pv-green-500)]',
    icon: 'text-pv-green-500',
    path: (
      <path d="M5 11l4 4L19 7" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    ),
  },
  error: {
    box: 'border-pv-red-500/30 bg-pv-red-50 text-[color:var(--pv-red-500)]',
    icon: 'text-pv-red-500',
    path: (
      <>
        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
        <path d="M12 8v4.5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
        <circle cx="12" cy="16" r="1.2" fill="currentColor" />
      </>
    ),
  },
  warning: {
    box: 'border-pv-amber-500/30 bg-pv-amber-50 text-[#92400e]',
    icon: 'text-pv-amber-500',
    path: (
      <>
        <path d="M12 3l10 18H2L12 3z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
        <path d="M12 10v5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
        <circle cx="12" cy="18" r="1.2" fill="currentColor" />
      </>
    ),
  },
  info: {
    box: 'border-pv-navy-600/20 bg-pv-navy-100 text-pv-navy-800',
    icon: 'text-pv-navy-600',
    path: (
      <>
        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
        <path d="M12 11v5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
        <circle cx="12" cy="8" r="1.2" fill="currentColor" />
      </>
    ),
  },
};

export function Alert({ variant = 'info', title, children, className }: Props) {
  const v = variants[variant];
  return (
    <div
      role={variant === 'error' ? 'alert' : 'status'}
      className={cn('flex gap-3 rounded-[12px] border px-3.5 py-3 text-[13px]', v.box, className)}
    >
      <svg
        className={cn('mt-0.5 h-4 w-4 shrink-0', v.icon)}
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
      >
        {v.path}
      </svg>
      <div className="min-w-0">
        {title && <p className="mb-0.5 font-semibold">{title}</p>}
        <div className="leading-snug">{children}</div>
      </div>
    </div>
  );
}
