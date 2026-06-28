'use client';

import { createPortal } from 'react-dom';
import { InlineSpinner } from '@/components/ui/inline-spinner';

/**
 * Overlay di caricamento a tutto schermo mostrato durante il cambio di sede
 * operativa, finché i dati non sono ri-renderizzati con il nuovo scoping.
 * Blocca l'interazione. Renderizzato via portal su <body> per stare sopra
 * sidebar/modali a prescindere dallo stacking context dell'header che contiene
 * il selettore.
 */
export function SedeSwitchOverlay({ show }: { show: boolean }) {
  if (!show || typeof document === 'undefined') return null;

  return createPortal(
    <div
      role="status"
      aria-busy="true"
      className="fixed inset-0 z-[200] flex flex-col items-center justify-center gap-3 bg-white/70 backdrop-blur-sm"
    >
      <InlineSpinner className="h-9 w-9 text-pv-navy-700" />
      <span className="text-[14px] font-semibold text-pv-navy-900">
        Aggiornamento sede…
      </span>
    </div>,
    document.body,
  );
}
