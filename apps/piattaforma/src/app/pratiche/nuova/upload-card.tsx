'use client';

import { useEffect, useId, useMemo, useState } from 'react';
import { useDocumentScanner } from '@/components/document-scanner-modal';
import { isPdfFile } from '@/lib/scanner/pdf-render';
import type { BlobRef } from '@/lib/blob/upload-client';

/**
 * Slot di upload diretto su Vercel Blob. Il browser carica il file
 * direttamente su Blob (aggira il limite 4,5 MB sul body delle Server Action)
 * e teniamo in stato solo la BlobRef (il "gettone"). `file` è conservato solo
 * per l'anteprima locale (nome/dimensione/immagine) e NON viene mai inviato al
 * server né alle action OCR. `uploading`/`progress`/`error` guidano la UI.
 */
export type BlobSlot = {
  ref: BlobRef | null;
  file: File | null;
  uploading: boolean;
  progress: number;
  error: string | null;
};

export function UploadCard({
  label,
  slot,
  onSelect,
  onRemove,
  invalid = false,
  pdfOnly = false,
  subtitle,
}: {
  label: string;
  slot: BlobSlot | undefined;
  onSelect: (file: File | null) => void;
  onRemove: () => void;
  invalid?: boolean;
  /** Solo PDF + bypass editor (documento multipagina da caricare intero: SOLO
   *  la visura camerale). Tutto il resto passa dallo scanner. */
  pdfOnly?: boolean;
  /** Testo guida sotto il titolo della card. */
  subtitle?: string;
}) {
  const [localErr, setLocalErr] = useState<string | null>(null);
  const file = slot?.file ?? null;
  const ref = slot?.ref ?? null;
  // Nome/dimensione: dal File se presente, altrimenti dalla BlobRef (bozza
  // ripristinata dopo un refresh: il file è già su Blob, ma l'oggetto File
  // locale non esiste più).
  const docSize = file?.size ?? ref?.size ?? null;
  const hasDoc = !!file || !!ref;
  // Immagini → editor scansione (ritaglio/migliora); PDF → upload diretto.
  const { pick, modal } = useDocumentScanner({ onFile: onSelect });
  // pdfOnly (SOLO la visura): bypassa l'editor e carica il PDF intero (tutte le
  // pagine, documento multipagina); rifiuta i non-PDF. Per tutto il resto
  // (libretto, foglio complementare, …) si passa dallo scanner: immagini →
  // editor ritaglio/migliora; PDF → editor pagina per pagina (esporta la pagina
  // scelta come JPEG). L'editor serve anche sul foglio: spesso è la foto storta
  // di un documento da raddrizzare/ritagliare.
  const handlePick = (f: File | null): void => {
    if (!f) {
      setLocalErr(null);
      onSelect(null);
      return;
    }
    if (pdfOnly) {
      if (!isPdfFile(f)) {
        setLocalErr('Il documento deve essere in formato PDF.');
        return;
      }
      setLocalErr(null);
      onSelect(f);
      return;
    }
    pick(f);
  };
  // L'id DEVE essere unico per ISTANZA: più UploadCard con la stessa `label`
  // (es. "Fronte"/"Retro" per venditore 1 e venditore 2, o acquirente +
  // co-intestatario) convivono nello stesso DOM. Derivare l'id dalla sola
  // label produceva id duplicati: `<label htmlFor>` attiva SEMPRE il primo
  // input con quell'id nel DOM, così il file scelto per la 2ª card finiva
  // sulla 1ª (documenti del 2° intestatario sovrascritti sul 1°). `useId`
  // garantisce un id distinto per ogni istanza.
  const uid = useId();
  const inputId = `upload-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}-${uid}`;
  const previewUrl = useMemo(
    () => (file && file.type.startsWith('image/') ? URL.createObjectURL(file) : null),
    [file],
  );
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const isPdf = (file?.type ?? ref?.type) === 'application/pdf';
  const caricato = !!slot?.ref && !slot.uploading;
  const uploading = !!slot?.uploading;
  const erroreUpload = slot?.error ?? null;

  return (
    <div
      className={`rounded-xl border p-4 transition ${
        invalid || erroreUpload
          ? 'border-pv-red-500 bg-pv-red-50'
          : caricato
            ? 'border-pv-green-500/40 bg-pv-green-50'
            : 'border-pv-slate-200 bg-white'
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[13px] font-semibold text-pv-navy-900">{label}</span>
        {uploading ? (
          <span className="rounded-full bg-pv-navy-50 px-2 py-0.5 text-[11px] font-semibold text-pv-navy-700">
            Caricamento… {slot?.progress ?? 0}%
          </span>
        ) : caricato ? (
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
          {hasDoc ? (
            <>
              {/* Il nome file originale è volutamente nascosto: mostriamo solo
                  che il documento (identificato dalla label in alto) è caricato. */}
              <p className="text-[12px] font-medium text-pv-slate-700">
                {isPdf ? 'Documento PDF caricato' : 'Documento caricato'}
              </p>
              {docSize != null && (
                <p className="text-[11px] text-pv-slate-500">
                  {(docSize / 1024 / 1024).toFixed(2)} MB
                </p>
              )}
            </>
          ) : (
            <p className="text-[12px] text-pv-slate-500">
              {pdfOnly ? 'Solo PDF · max 10 MB' : 'PDF, JPG o PNG · max 10 MB'}
            </p>
          )}
          {(erroreUpload || localErr) && (
            <p className="mt-0.5 text-[11px] font-semibold text-pv-red-500">{erroreUpload ?? localErr}</p>
          )}
          <div className="mt-1.5 flex gap-3">
            <label
              htmlFor={inputId}
              className="cursor-pointer text-[12px] font-semibold text-pv-navy-600 hover:underline"
            >
              {hasDoc ? 'Sostituisci' : 'Carica file'}
            </label>
            {hasDoc && (
              <button
                type="button"
                onClick={onRemove}
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
        accept={pdfOnly ? 'application/pdf' : 'application/pdf,image/jpeg,image/png,image/jpg'}
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
