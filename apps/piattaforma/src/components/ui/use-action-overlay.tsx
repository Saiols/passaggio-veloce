'use client';

import { useTransition, type ReactNode } from 'react';
import { LoadingOverlay } from './loading-overlay';

/**
 * Bundle `useTransition` + overlay di caricamento a tutto schermo, per le CTA
 * che invocano azioni non istantanee (server action, salvataggi, cambio dati).
 *
 * Uso tipico:
 * ```tsx
 * const { pending, run, overlay } = useActionOverlay('Salvataggio…');
 * // ...
 * <button disabled={pending} onClick={() => run(async () => { await azione(); router.refresh(); })}>
 *   Salva
 * </button>
 * {overlay}
 * ```
 */
export function useActionOverlay(label?: string): {
  pending: boolean;
  run: (fn: () => Promise<void> | void) => void;
  overlay: ReactNode;
} {
  const [pending, startTransition] = useTransition();
  const run = (fn: () => Promise<void> | void) =>
    startTransition(async () => {
      await fn();
    });
  const overlay = <LoadingOverlay show={pending} label={label} />;
  return { pending, run, overlay };
}
