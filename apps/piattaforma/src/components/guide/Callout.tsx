type Variant = 'info' | 'warning' | 'tip';

const STYLES: Record<Variant, { bg: string; border: string; iconColor: string; titleColor: string }> = {
  info:    { bg: 'bg-pv-navy-50',   border: 'border-pv-navy-200',   iconColor: 'text-pv-navy-700',   titleColor: 'text-pv-navy-900' },
  warning: { bg: 'bg-pv-orange-50', border: 'border-pv-orange-300', iconColor: 'text-pv-orange-500', titleColor: 'text-pv-orange-700' },
  tip:     { bg: 'bg-pv-green-50',  border: 'border-pv-green-200',  iconColor: 'text-pv-green-500',  titleColor: 'text-pv-green-700' },
};

export function Callout({
  variant = 'info',
  title,
  children,
}: {
  variant?: Variant;
  title?: string;
  children: React.ReactNode;
}) {
  const s = STYLES[variant];
  return (
    <aside className={`my-6 rounded-[12px] border ${s.border} ${s.bg} p-5`}>
      <div className="flex items-start gap-3">
        <span className={`mt-0.5 ${s.iconColor}`} aria-hidden="true">
          <CalloutIcon variant={variant} />
        </span>
        <div className="flex-1 text-[14px] leading-relaxed text-pv-slate-700">
          {title && <p className={`mb-1 font-bold ${s.titleColor}`}>{title}</p>}
          {children}
        </div>
      </div>
    </aside>
  );
}

function CalloutIcon({ variant }: { variant: Variant }) {
  if (variant === 'warning') {
    return (
      <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5">
        <path d="M12 9v4M12 17h.01M10.3 3.86 1.82 18a2 2 0 0 0 1.7 3h16.96a2 2 0 0 0 1.7-3L13.7 3.86a2 2 0 0 0-3.4 0z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (variant === 'tip') {
    return (
      <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5">
        <path d="M12 2v2M5 5l1.4 1.4M2 12h2M5 19l1.4-1.4M12 22v-2M19 19l-1.4-1.4M22 12h-2M19 5l-1.4 1.4M12 17a5 5 0 1 1 0-10 5 5 0 0 1 0 10z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" />
      <path d="M12 8v4M12 16h.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
