import { cn } from './cn';

/**
 * Spinner inline per bottoni/elementi custom che non usano il componente Button
 * (es. pill compatte, bottoni con styling proprio). Eredita il colore corrente
 * (currentColor). Dimensione di default h-4 w-4, sovrascrivibile via className.
 */
export function InlineSpinner({ className }: { className?: string }) {
  return (
    <svg
      className={cn('h-4 w-4 animate-spin', className)}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.5" strokeOpacity="0.25" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}
