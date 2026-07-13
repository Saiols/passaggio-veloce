'use client';

import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export type ModalSize = 'sm' | 'md' | 'lg';

export type ModalProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  size?: ModalSize;
  children: ReactNode;
};

const SIZE_CLASS: Record<ModalSize, string> = {
  sm: 'max-w-md',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
};

/**
 * Dialog modale riutilizzabile (primitiva UI). Tailwind puro, niente
 * dipendenze esterne. Close su Esc, click overlay e bottone X; focus trap
 * basico; body scroll-lock; portal in <body>; markup ARIA dialog/modal.
 */
export function Modal({
  open,
  onClose,
  title,
  description,
  size = 'md',
  children,
}: ModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);
  const titleId = useId();

  // `onClose` va letto da una ref, MAI messo nelle deps dell'effect qui
  // sotto. I consumer passano quasi sempre un arrow inline
  // (`onClose={() => setOpen(false)}`), quindi la sua identità cambia ad
  // ogni render del consumer. Se `onClose` fosse nelle deps, un campo
  // controllato dentro il modale (es. una <textarea> con value+onChange)
  // farebbe ri-eseguire l'effect ad ogni tasto premuto, e l'effect rifà
  // `firstFocusable.focus()` sul primo elemento focusabile del dialog —
  // che è il bottone "✕" — strappando il focus dal campo che si sta
  // scrivendo. Bug reale riprodotto in modal.test.tsx.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    if (!open) return;
    previouslyFocused.current = document.activeElement as HTMLElement | null;
    document.documentElement.classList.add('overflow-hidden');
    const handleKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCloseRef.current();
        return;
      }
      if (e.key === 'Tab' && dialogRef.current) {
        const focusables = dialogRef.current.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])',
        );
        if (focusables.length === 0) return;
        const first = focusables[0]!;
        const last = focusables[focusables.length - 1]!;
        const active = document.activeElement as HTMLElement | null;
        if (e.shiftKey && active === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && active === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener('keydown', handleKey);
    queueMicrotask(() => {
      const firstFocusable = dialogRef.current?.querySelector<HTMLElement>(
        'input, button, textarea, select, [tabindex]:not([tabindex="-1"])',
      );
      firstFocusable?.focus();
    });
    return () => {
      window.removeEventListener('keydown', handleKey);
      document.documentElement.classList.remove('overflow-hidden');
      previouslyFocused.current?.focus?.();
    };
    // SOLO `open` in deps — vedi il commento su `onCloseRef` sopra.
  }, [open]);

  if (!open) return null;
  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
      className="pv-modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-4"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={`pv-modal-panel relative flex max-h-[calc(100dvh-2rem)] w-full ${SIZE_CLASS[size]} flex-col overflow-hidden rounded-2xl bg-white shadow-[var(--pv-shadow-card)]`}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Chiudi"
          className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-full text-pv-slate-500 hover:bg-pv-slate-100 hover:text-pv-navy-900"
        >
          ✕
        </button>
        <div className="shrink-0 border-b border-pv-slate-200 px-6 py-4 pr-12">
          <h2 id={titleId} className="text-[16px] font-bold text-pv-navy-900">
            {title}
          </h2>
          {description && (
            <p className="mt-1 text-[12.5px] text-pv-slate-500">{description}</p>
          )}
        </div>
        {/* Il pannello è alto al massimo quanto il viewport: il corpo scrolla
            da solo (il body è in scroll-lock, senza questo un contenuto alto
            — es. la matrice permessi aperta — resterebbe irraggiungibile). */}
        <div className="flex-1 overflow-y-auto px-6 py-5">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
