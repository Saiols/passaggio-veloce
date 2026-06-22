'use client';

import { useToast } from '@/components/ui';

/**
 * Bottone "Scarica documenti (ZIP)" del broker. Lo zip può impiegare qualche
 * secondo a generarsi: il download resta nativo (in background, l'utente può
 * continuare a navigare) ma al click mostriamo un toast così è chiaro che è
 * partito.
 */
export function DownloadDocumentiButton() {
  const toast = useToast();
  return (
    <a
      href="/api/pratiche/documenti-zip"
      download
      onClick={() =>
        toast(
          'Download avviato in background — la preparazione dello ZIP può richiedere qualche secondo.',
          'info',
        )
      }
      className="inline-flex items-center gap-2 rounded-[10px] border-[1.5px] border-pv-slate-300 bg-white px-[18px] py-3 text-sm font-bold text-pv-navy-700 transition-colors hover:bg-pv-slate-50"
    >
      Scarica documenti (ZIP)
    </a>
  );
}
