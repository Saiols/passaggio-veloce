'use client';

import { useMemo, useEffect } from 'react';
import { useDocumentScanner } from '@/components/document-scanner-modal';

const ACCEPT = 'application/pdf,image/jpeg,image/png,image/jpg';

export function DocCard({
  label,
  file,
  onChange,
  invalid = false,
}: {
  label: string;
  file: File | null;
  onChange: (f: File | null) => void;
  /** Evidenzia la card quando il gate KYC ha segnalato un problema su questo documento. */
  invalid?: boolean;
}) {
  // Immagini → editor scansione (ritaglio/migliora); PDF → upload diretto.
  const { pick, modal } = useDocumentScanner({ onFile: onChange });
  const inputId = `doc-file-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;
  const previewUrl = useMemo(
    () => (file && file.type.startsWith('image/') ? URL.createObjectURL(file) : null),
    [file],
  );

  // Revoca l'object URL quando cambia/si smonta (no setState nell'effect).
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const isPdf = file?.type === 'application/pdf';

  return (
    <div
      className={`rounded-xl border p-4 transition ${
        invalid
          ? 'border-pv-red-500 bg-pv-red-50'
          : file
            ? 'border-pv-green-500/40 bg-pv-green-50'
            : 'border-pv-slate-200 bg-white'
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[13px] font-semibold text-pv-navy-900">{label}</span>
        {file ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-pv-green-500/10 px-2 py-0.5 text-[11px] font-semibold text-pv-green-500">
            ✓ Caricato
          </span>
        ) : (
          <span className="rounded-full bg-pv-slate-100 px-2 py-0.5 text-[11px] font-semibold text-pv-slate-500">
            Da caricare
          </span>
        )}
      </div>

      <div className="mt-3 flex items-center gap-3">
        <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-pv-slate-200 bg-pv-slate-50">
          {previewUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={previewUrl} alt={`Anteprima ${label}`} className="h-full w-full object-cover" />
          ) : (
            <span className="text-[11px] font-bold text-pv-slate-400">{isPdf ? 'PDF' : 'DOC'}</span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          {file ? (
            <>
              <p className="truncate text-[12px] text-pv-slate-700" title={file.name}>
                {file.name}
              </p>
              <p className="text-[11px] text-pv-slate-500">
                {(file.size / 1024 / 1024).toFixed(2)} MB
              </p>
            </>
          ) : (
            <p className="text-[12px] text-pv-slate-500">PDF, JPG o PNG · max 10 MB</p>
          )}
          <div className="mt-1.5 flex gap-3">
            <label
              htmlFor={inputId}
              className="cursor-pointer text-[12px] font-semibold text-pv-navy-600 hover:underline"
            >
              {file ? 'Sostituisci' : 'Carica file'}
            </label>
            {file && (
              <button
                type="button"
                onClick={() => onChange(null)}
                className="text-[12px] font-semibold text-pv-red-500 hover:underline"
              >
                Rimuovi
              </button>
            )}
          </div>
        </div>
      </div>

      <input
        id={inputId}
        type="file"
        accept={ACCEPT}
        className="sr-only"
        onChange={(e) => {
          pick(e.target.files?.[0] ?? null);
          e.target.value = '';
        }}
      />
      {modal}
    </div>
  );
}
