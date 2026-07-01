'use client';

import { createPortal } from 'react-dom';
import { InlineSpinner } from './inline-spinner';

/**
 * Overlay di caricamento a tutto schermo, mostrato mentre un'azione non
 * istantanea è in corso (server action, salvataggio, cambio dati visualizzati).
 * Blocca l'interazione e dà all'utente un segnale immediato che "sta succedendo
 * qualcosa". Renderizzato via portal su <body> per stare sopra sidebar/modali a
 * prescindere dallo stacking context del componente che lo invoca.
 *
 * Generalizza il pattern nato per il cambio sede (SedeSwitchOverlay).
 */
export function LoadingOverlay({
  show,
  label = 'Attendere…',
}: {
  show: boolean;
  label?: string;
}) {
  if (!show || typeof document === 'undefined') return null;

  return createPortal(
    <div
      role="status"
      aria-busy="true"
      className="fixed inset-0 z-[200] flex flex-col items-center justify-center gap-3 bg-white/70 backdrop-blur-sm"
    >
      <InlineSpinner className="h-9 w-9 text-pv-navy-700" />
      <span className="text-[14px] font-semibold text-pv-navy-900">{label}</span>
    </div>,
    document.body,
  );
}
