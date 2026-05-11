'use client';

import { useEffect, useRef, type ReactNode } from 'react';
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

  useEffect(() => {
    if (!open) return;
    previouslyFocused.current = document.activeElement as HTMLElement | null;
    document.documentElement.classList.add('overflow-hidden');
    const handleKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
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
  }, [open, onClose]);

  if (!open) return null;
  if (typeof document === 'undefined') return null;

  const titleId = `modal-title-${Math.random().toString(36).slice(2, 9)}`;

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
        className={`pv-modal-panel relative w-full ${SIZE_CLASS[size]} overflow-hidden rounded-2xl bg-white shadow-[var(--pv-shadow-card)]`}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Chiudi"
          className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-full text-pv-slate-500 hover:bg-pv-slate-100 hover:text-pv-navy-900"
        >
          ✕
        </button>
        <div className="border-b border-pv-slate-200 px-6 py-4 pr-12">
          <h2 id={titleId} className="text-[16px] font-bold text-pv-navy-900">
            {title}
          </h2>
          {description && (
            <p className="mt-1 text-[12.5px] text-pv-slate-500">{description}</p>
          )}
        </div>
        <div className="px-6 py-5">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
