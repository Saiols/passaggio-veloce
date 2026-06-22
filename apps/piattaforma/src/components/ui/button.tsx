import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { forwardRef } from 'react';
import { cn } from './cn';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md';

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  loadingLabel?: string;
  leadingIcon?: ReactNode;
  fullWidth?: boolean;
};

const base =
  'inline-flex items-center justify-center gap-2 rounded-[10px] font-bold tracking-tight ' +
  'transition-[background,box-shadow,transform] duration-150 ease-out ' +
  'active:scale-[0.98] focus-visible:outline-none focus-visible:shadow-[var(--pv-ring-focus)] ' +
  'disabled:cursor-not-allowed disabled:active:scale-100';

const variants: Record<Variant, string> = {
  primary:
    'bg-pv-orange-500 text-white shadow-[var(--pv-shadow-cta)] hover:bg-pv-orange-600 ' +
    'disabled:bg-pv-slate-300 disabled:text-pv-slate-500 disabled:shadow-none',
  secondary:
    'bg-white text-pv-navy-700 border border-[1.5px] border-pv-slate-300 hover:bg-pv-slate-50 ' +
    'disabled:bg-pv-slate-50 disabled:text-pv-slate-500 disabled:border-pv-slate-200',
  ghost:
    'bg-transparent text-pv-navy-600 hover:underline underline-offset-4 ' +
    'disabled:text-pv-slate-500 disabled:no-underline',
  danger:
    'bg-pv-red-500 text-white shadow-[0_8px_18px_rgb(220_38_38_/_0.28)] hover:brightness-110 ' +
    'disabled:bg-pv-slate-300 disabled:text-pv-slate-500 disabled:shadow-none',
};

const sizes: Record<Size, string> = {
  sm: 'text-[13px] px-3.5 py-2',
  md: 'text-sm px-[18px] py-3',
};

const Spinner = () => (
  <svg
    className="h-4 w-4 animate-spin"
    viewBox="0 0 24 24"
    fill="none"
    aria-hidden="true"
  >
    <circle
      cx="12"
      cy="12"
      r="9"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeOpacity="0.25"
    />
    <path
      d="M21 12a9 9 0 0 0-9-9"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
    />
  </svg>
);

export const Button = forwardRef<HTMLButtonElement, Props>(function Button(
  {
    variant = 'primary',
    size = 'md',
    loading = false,
    loadingLabel = 'Attendi…',
    leadingIcon,
    fullWidth = false,
    className,
    disabled,
    children,
    type = 'button',
    ...rest
  },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        base,
        variants[variant],
        sizes[size],
        fullWidth && 'w-full',
        loading && 'cursor-wait',
        className,
      )}
      {...rest}
    >
      {loading ? <Spinner /> : leadingIcon}
      <span>{loading ? loadingLabel : children}</span>
    </button>
  );
});
