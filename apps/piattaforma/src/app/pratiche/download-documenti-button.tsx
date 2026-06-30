'use client';

import { useToast } from '@/components/ui';

/**
 * Bottone "Scarica documenti (ZIP)". Lo zip può impiegare qualche secondo a
 * generarsi: il download resta nativo (in background, l'utente può continuare a
 * navigare) ma al click mostriamo un toast così è chiaro che è partito.
 *
 * Default = ZIP globale dei documenti del broker (lista pratiche). Passando
 * `href` si punta a uno ZIP specifico (es. `/api/pratiche/<id>/zip` nel
 * dettaglio: nome ZIP e file referenziano la pratica).
 */
export function DownloadDocumentiButton({
  href = '/api/pratiche/documenti-zip',
  label = 'Scarica documenti (ZIP)',
  className = 'inline-flex items-center gap-2 rounded-[10px] border-[1.5px] border-pv-slate-300 bg-white px-[18px] py-3 text-sm font-bold text-pv-navy-700 transition-colors hover:bg-pv-slate-50',
}: {
  href?: string;
  label?: string;
  className?: string;
} = {}) {
  const toast = useToast();
  return (
    <a
      href={href}
      download
      onClick={() =>
        toast(
          'Download avviato in background — la preparazione dello ZIP può richiedere qualche secondo.',
          'info',
        )
      }
      className={className}
    >
      {label}
    </a>
  );
}
