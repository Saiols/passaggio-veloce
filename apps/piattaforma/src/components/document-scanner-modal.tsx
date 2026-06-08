'use client';
/* eslint-disable @typescript-eslint/no-explicit-any */

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Alert, Button } from '@/components/ui';
import { loadOpenCv } from '@/lib/scanner/opencv-loader';
import {
  isImageFile,
  imageFileToCanvas,
  canvasToJpegFile,
  type Preset,
} from '@/lib/scanner/process';

type Pt = { x: number; y: number };
type Corners = {
  topLeftCorner: Pt;
  topRightCorner: Pt;
  bottomRightCorner: Pt;
  bottomLeftCorner: Pt;
};
type HandleKey = keyof Corners;

const HANDLE_ORDER: HandleKey[] = [
  'topLeftCorner',
  'topRightCorner',
  'bottomRightCorner',
  'bottomLeftCorner',
];

const PRESETS: { value: Preset; label: string }[] = [
  { value: 'originale', label: 'Originale' },
  { value: 'colore', label: 'Colore migliorato' },
  { value: 'bn', label: 'Bianco e nero' },
];

/** Decisione di routing alla selezione di un file (puro, testabile). */
export function routeSelection(file: File | null): 'editor' | 'passthrough' | 'noop' {
  if (!file) return 'noop';
  return isImageFile(file) ? 'editor' : 'passthrough';
}

/**
 * Hook condiviso: intercetta la selezione di un file. Immagine → apre l'editor
 * di scansione; PDF/altro → passa diretto a `onFile`. Restituisce `pick` (da
 * collegare all'input) e `modal` (nodo da renderizzare).
 */
export function useDocumentScanner({ onFile }: { onFile: (f: File | null) => void }): {
  pick: (file: File | null) => void;
  modal: ReactNode;
} {
  const [pending, setPending] = useState<File | null>(null);
  const pick = (file: File | null) => {
    switch (routeSelection(file)) {
      case 'editor':
        setPending(file);
        break;
      case 'passthrough':
        onFile(file);
        break;
      case 'noop':
        onFile(null);
        break;
    }
  };
  const modal = pending ? (
    <DocumentScannerModal
      file={pending}
      onConfirm={(f) => {
        onFile(f);
        setPending(null);
      }}
      onCancel={() => setPending(null)}
    />
  ) : null;
  return { pick, modal };
}

function dist(a: Pt, b: Pt): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function boundsCorners(w: number, h: number): Corners {
  const ix = w * 0.05;
  const iy = h * 0.05;
  return {
    topLeftCorner: { x: ix, y: iy },
    topRightCorner: { x: w - ix, y: iy },
    bottomRightCorner: { x: w - ix, y: h - iy },
    bottomLeftCorner: { x: ix, y: h - iy },
  };
}

export function DocumentScannerModal({
  file,
  onConfirm,
  onCancel,
}: {
  file: File;
  onConfirm: (f: File) => void;
  onCancel: () => void;
}): ReactNode {
  const [activeFile, setActiveFile] = useState<File>(file);
  const [src, setSrc] = useState<{ canvas: HTMLCanvasElement; url: string } | null>(null);
  const [corners, setCorners] = useState<Corners | null>(null);
  const [preset, setPreset] = useState<Preset>('originale');
  const [status, setStatus] = useState<'loading' | 'ready' | 'error' | 'working'>('loading');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const dragging = useRef<HandleKey | null>(null);

  // Carica l'immagine + OpenCV/jscanify e rileva i bordi. Re-esegue al cambio
  // file (es. "Scatta foto").
  useEffect(() => {
    let cancelled = false;
    let url: string | null = null;
    (async () => {
      setStatus('loading');
      setErrorMsg(null);
      try {
        const canvas = await imageFileToCanvas(activeFile);
        url = canvas.toDataURL('image/jpeg', 0.92);
        if (cancelled) return;
        setSrc({ canvas, url });
        // Default: bordi pieni (verrà sovrascritto se l'auto-detect riesce).
        setCorners(boundsCorners(canvas.width, canvas.height));
        try {
          const cv = await loadOpenCv();
          const mod: any = await import('jscanify/client');
          const Jscanify = mod?.default ?? mod;
          const scanner = new Jscanify();
          const mat = cv.imread(canvas);
          const contour = scanner.findPaperContour(mat);
          if (contour) {
            const c = scanner.getCornerPoints(contour);
            if (c?.topLeftCorner && c?.bottomRightCorner && !cancelled) setCorners(c);
          }
          mat.delete();
          if (!cancelled) setStatus('ready');
        } catch {
          // OpenCV non disponibile: l'utente può comunque usare l'originale.
          if (!cancelled) {
            setStatus('error');
            setErrorMsg('Elaborazione non disponibile: puoi caricare l’originale.');
          }
        }
      } catch {
        if (!cancelled) {
          setStatus('error');
          setErrorMsg('Immagine non leggibile.');
        }
      }
    })();
    return () => {
      cancelled = true;
      if (url) {
        /* dataURL: niente da revocare */
      }
    };
  }, [activeFile]);

  const displayScale = (): number => {
    if (!src || !imgRef.current) return 1;
    return imgRef.current.clientWidth / src.canvas.width;
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const key = dragging.current;
    if (!key || !src || !imgRef.current) return;
    const rect = imgRef.current.getBoundingClientRect();
    const s = rect.width / src.canvas.width;
    const x = Math.max(0, Math.min(src.canvas.width, (e.clientX - rect.left) / s));
    const y = Math.max(0, Math.min(src.canvas.height, (e.clientY - rect.top) / s));
    setCorners((prev) => (prev ? { ...prev, [key]: { x, y } } : prev));
  };

  const rotate = () => {
    if (!src) return;
    const { canvas } = src;
    const out = document.createElement('canvas');
    out.width = canvas.height;
    out.height = canvas.width;
    const ctx = out.getContext('2d')!;
    ctx.translate(out.width, 0);
    ctx.rotate(Math.PI / 2);
    ctx.drawImage(canvas, 0, 0);
    setSrc({ canvas: out, url: out.toDataURL('image/jpeg', 0.92) });
    setCorners(boundsCorners(out.width, out.height));
  };

  const conferma = async () => {
    if (!src || !corners) return;
    setStatus('working');
    try {
      const cv = await loadOpenCv();
      const mod: any = await import('jscanify/client');
      const Jscanify = mod?.default ?? mod;
      const scanner = new Jscanify();
      const outW = Math.round(
        Math.max(dist(corners.topLeftCorner, corners.topRightCorner), dist(corners.bottomLeftCorner, corners.bottomRightCorner)),
      );
      const outH = Math.round(
        Math.max(dist(corners.topLeftCorner, corners.bottomLeftCorner), dist(corners.topRightCorner, corners.bottomRightCorner)),
      );
      const warped: HTMLCanvasElement = scanner.extractPaper(src.canvas, outW, outH, corners);
      const finalCanvas = applyPreset(cv, warped, preset);
      const out = await canvasToJpegFile(finalCanvas, activeFile.name);
      onConfirm(out);
    } catch {
      setStatus('error');
      setErrorMsg('Elaborazione fallita: puoi caricare l’originale.');
    }
  };

  const scale = displayScale();
  const handlePx = (p: Pt) => ({ left: p.x * scale, top: p.y * scale });

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-pv-navy-900/90 p-3 sm:p-6">
      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col overflow-hidden rounded-[16px] bg-white">
        <div className="flex items-center justify-between border-b border-pv-slate-200 px-4 py-3">
          <h2 className="text-[15px] font-bold text-pv-navy-900">Ritaglia e migliora</h2>
          <button onClick={onCancel} className="text-[13px] font-semibold text-pv-slate-500 hover:text-pv-navy-800">
            Annulla
          </button>
        </div>

        <div className="flex-1 overflow-auto p-4">
          {errorMsg && <Alert variant="warning">{errorMsg}</Alert>}
          {status === 'loading' && (
            <p className="py-10 text-center text-[13px] text-pv-slate-500">Caricamento immagine…</p>
          )}
          {src && (
            <div
              className="relative mx-auto w-full select-none touch-none"
              onPointerMove={onPointerMove}
              onPointerUp={() => (dragging.current = null)}
              onPointerLeave={() => (dragging.current = null)}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img ref={imgRef} src={src.url} alt="documento" className="w-full rounded-[8px]" draggable={false} />
              {corners && (status === 'ready' || status === 'working') && (
                <>
                  <svg className="pointer-events-none absolute inset-0 h-full w-full">
                    <polygon
                      points={HANDLE_ORDER.map((k) => {
                        const p = handlePx(corners[k]);
                        return `${p.left},${p.top}`;
                      }).join(' ')}
                      fill="rgba(255,122,0,0.12)"
                      stroke="#ff7a00"
                      strokeWidth={2}
                    />
                  </svg>
                  {HANDLE_ORDER.map((k) => {
                    const p = handlePx(corners[k]);
                    return (
                      <div
                        key={k}
                        onPointerDown={(e) => {
                          (e.target as HTMLElement).setPointerCapture(e.pointerId);
                          dragging.current = k;
                        }}
                        className="absolute h-6 w-6 -translate-x-1/2 -translate-y-1/2 cursor-grab rounded-full border-2 border-pv-orange-500 bg-white shadow"
                        style={{ left: p.left, top: p.top }}
                      />
                    );
                  })}
                </>
              )}
            </div>
          )}
        </div>

        <div className="border-t border-pv-slate-200 px-4 py-3">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <Button variant="secondary" onClick={rotate} disabled={!src || status === 'working'}>
              Ruota
            </Button>
            <div className="flex gap-1">
              {PRESETS.map((p) => (
                <button
                  key={p.value}
                  onClick={() => setPreset(p.value)}
                  className={`rounded-[8px] border px-2.5 py-1.5 text-[12px] font-semibold transition ${
                    preset === p.value
                      ? 'border-pv-orange-500 bg-pv-orange-500/10 text-pv-orange-600'
                      : 'border-pv-slate-200 text-pv-slate-600 hover:border-pv-navy-400'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <label className="cursor-pointer rounded-[8px] border border-pv-slate-200 px-2.5 py-1.5 text-[12px] font-semibold text-pv-slate-600 hover:border-pv-navy-400">
              Scatta foto
              <input
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) setActiveFile(f);
                }}
              />
            </label>
          </div>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
            <Button variant="secondary" onClick={() => onConfirm(activeFile)} disabled={status === 'working'}>
              Usa originale
            </Button>
            <Button
              onClick={conferma}
              disabled={status !== 'ready'}
              loading={status === 'working'}
              loadingLabel="Elaborazione…"
            >
              Conferma
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Applica il preset al canvas raddrizzato. */
function applyPreset(cv: any, warped: HTMLCanvasElement, preset: Preset): HTMLCanvasElement {
  if (preset === 'originale') return warped;
  if (preset === 'colore') {
    const out = document.createElement('canvas');
    out.width = warped.width;
    out.height = warped.height;
    const ctx = out.getContext('2d')!;
    ctx.filter = 'contrast(1.18) brightness(1.06) saturate(1.05)';
    ctx.drawImage(warped, 0, 0);
    return out;
  }
  // bn: grayscale + adaptiveThreshold (look "scansione").
  const src = cv.imread(warped);
  const gray = new cv.Mat();
  cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
  const dst = new cv.Mat();
  cv.adaptiveThreshold(gray, dst, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY, 15, 10);
  const out = document.createElement('canvas');
  cv.imshow(out, dst);
  src.delete();
  gray.delete();
  dst.delete();
  return out;
}
