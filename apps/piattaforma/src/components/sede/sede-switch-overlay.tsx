'use client';

import { LoadingOverlay } from '@/components/ui/loading-overlay';

/**
 * Overlay di caricamento a tutto schermo mostrato durante il cambio di sede
 * operativa, finché i dati non sono ri-renderizzati con il nuovo scoping.
 * Sottile wrapper sul componente generico condiviso [LoadingOverlay].
 */
export function SedeSwitchOverlay({ show }: { show: boolean }) {
  return <LoadingOverlay show={show} label="Aggiornamento sede…" />;
}
