import type { ReactNode } from 'react';
import Link from 'next/link';
import { cn } from './cn';

type Props = {
  label: string;
  value: ReactNode;
  hint?: string;
  icon?: ReactNode;
  accent?: 'navy' | 'orange' | 'green' | 'red' | 'slate';
  href?: string;
};

const accents = {
  navy: 'bg-pv-navy-100 text-pv-navy-700',
  orange: 'bg-[color-mix(in_srgb,#ff7a00_12%,white)] text-pv-orange-500',
  green: 'bg-pv-green-50 text-pv-green-500',
  red: 'bg-pv-red-50 text-pv-red-500',
  slate: 'bg-pv-slate-100 text-pv-slate-700',
};

export function StatCard({ label, value, hint, icon, accent = 'navy', href }: Props) {
  const inner = (
    <>
      <div className="flex items-start justify-between">
        <p className="text-[11px] font-bold uppercase tracking-wider text-pv-slate-500">{label}</p>
        {icon && (
          <span className={cn('flex h-9 w-9 items-center justify-center rounded-[10px]', accents[accent])}>
            {icon}
          </span>
        )}
      </div>
      <p className="mt-2 text-[28px] font-extrabold tracking-tight text-pv-navy-900">{value}</p>
      {hint && <p className="mt-1 text-[12px] text-pv-slate-500">{hint}</p>}
    </>
  );

  const base =
    'block rounded-[16px] border border-pv-slate-200 bg-white p-5 shadow-[var(--pv-shadow-card)]';

  if (href) {
    return (
      <Link
        href={href}
        className={cn(
          base,
          'transition-[background,box-shadow,border-color] hover:border-pv-navy-300 hover:shadow-[var(--pv-shadow-card-lg)]',
        )}
      >
        {inner}
      </Link>
    );
  }
  return <div className={base}>{inner}</div>;
}
