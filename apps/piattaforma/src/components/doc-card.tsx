'use client';

import { useMemo, useEffect, useState } from 'react';
import { useDocumentScanner } from '@/components/document-scanner-modal';
import { isPdfFile } from '@/lib/scanner/pdf-render';

const ACCEPT = 'application/pdf,image/jpeg,image/png,image/jpg';

export function DocCard({
  label,
  file,
  onChange,
  invalid = false,
  pdfOnly = false,
  subtitle,
  uploaded = false,
  uploadedName,
  uploadedIsPdf = false,
}: {
  label: string;
  file: File | null;
  onChange: (f: File | null) => void;
  /** Evidenzia la card quando il gate KYC ha segnalato un problema su questo documento. */
  invalid?: boolean;
  /** Solo PDF + bypass editor (la visura va caricata intera, tutte le pagine). */
  pdfOnly?: boolean;
  /** Testo guida sotto il titolo della card. */
  subtitle?: string;
  /**
   * Documento GIÀ caricato di cui non abbiamo più l'oggetto `File` (es. dopo un
   * "Indietro"/refresh nel wizard: sopravvive solo la BlobRef). Fa mostrare alla
   * card lo stato "Caricato" — niente più "Da caricare" fuorviante — anche senza
   * miniatura. Quando `file` è presente ha precedenza e mostra l'anteprima reale.
   */
  uploaded?: boolean;
  /** Nome file da mostrare quando `uploaded` ma `file` è assente. */
  uploadedName?: string;
  /** Se il documento già caricato è un PDF (placeholder "PDF" invece di "DOC"). */
  uploadedIsPdf?: boolean;
}) {
  const [localErr, setLocalErr] = useState<string | null>(null);
  // Immagini → editor scansione (ritaglio/migliora); PDF → upload diretto.
  const { pick, modal } = useDocumentScanner({ onFile: onChange });
  // pdfOnly (visura): bypassa l'editor e carica il PDF intero (tutte le pagine);
  // rifiuta i non-PDF. Altrimenti instrada allo scanner come al solito.
  const handlePick = (f: File | null): void => {
    if (!f) {
      setLocalErr(null);
      onChange(null);
      return;
    }
    if (pdfOnly) {
      if (!isPdfFile(f)) {
        setLocalErr('La visura deve essere in formato PDF.');
        return;
      }
      setLocalErr(null);
      onChange(f);
      return;
    }
    pick(f);
  };
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

  // Lo stato "caricato" è guidato dal File (appena selezionato) OPPURE dal flag
  // `uploaded` (file già su Blob ma File non più in memoria dopo Indietro/refresh).
  const isUploaded = !!file || uploaded;
  const isPdf = file ? file.type === 'application/pdf' : uploadedIsPdf;
  const displayName = file?.name ?? uploadedName;

  return (
    <div
      className={`rounded-xl border p-4 transition ${
        invalid
          ? 'border-pv-red-500 bg-pv-red-50'
          : isUploaded
            ? 'border-pv-green-500/40 bg-pv-green-50'
            : 'border-pv-slate-200 bg-white'
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[13px] font-semibold text-pv-navy-900">{label}</span>
        {isUploaded ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-pv-green-500/10 px-2 py-0.5 text-[11px] font-semibold text-pv-green-500">
            ✓ Caricato
          </span>
        ) : (
          <span className="rounded-full bg-pv-slate-100 px-2 py-0.5 text-[11px] font-semibold text-pv-slate-500">
            Da caricare
          </span>
        )}
      </div>

      {subtitle && (
        <p className="mt-1 text-[11px] leading-snug text-pv-slate-500">{subtitle}</p>
      )}

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
          {isUploaded ? (
            <>
              <p className="truncate text-[12px] text-pv-slate-700" title={displayName}>
                {displayName ?? 'Documento caricato'}
              </p>
              {file && (
                <p className="text-[11px] text-pv-slate-500">
                  {(file.size / 1024 / 1024).toFixed(2)} MB
                </p>
              )}
            </>
          ) : (
            <p className="text-[12px] text-pv-slate-500">
              {pdfOnly ? 'Solo PDF · max 10 MB' : 'PDF, JPG o PNG · max 10 MB'}
            </p>
          )}
          {localErr && (
            <p className="mt-0.5 text-[11px] font-semibold text-pv-red-500">{localErr}</p>
          )}
          <div className="mt-1.5 flex gap-3">
            <label
              htmlFor={inputId}
              className="cursor-pointer text-[12px] font-semibold text-pv-navy-600 hover:underline"
            >
              {isUploaded ? 'Sostituisci' : 'Carica file'}
            </label>
            {isUploaded && (
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
        accept={pdfOnly ? 'application/pdf' : ACCEPT}
        className="sr-only"
        onChange={(e) => {
          handlePick(e.target.files?.[0] ?? null);
          e.target.value = '';
        }}
      />
      {modal}
    </div>
  );
}
