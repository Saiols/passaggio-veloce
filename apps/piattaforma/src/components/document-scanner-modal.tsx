'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Alert, Button } from '@/components/ui';
import { isImageFile, imageFileToCanvas, canvasToJpegFile, type Preset } from '@/lib/scanner/process';
import { warpImage, type Corners, type Pt } from '@/lib/scanner/scanner-client';

type HandleKey = keyof Corners;

const HANDLE_ORDER: HandleKey[] = [
  'topLeftCorner',
  'topRightCorner',
  'bottomRightCorner',
  'bottomLeftCorner',
];

/** Decisione di routing alla selezione di un file (puro, testabile). */
export function routeSelection(file: File | null): 'editor' | 'passthrough' | 'noop' {
  if (!file) return 'noop';
  return isImageFile(file) ? 'editor' : 'passthrough';
}

/**
 * Hook condiviso: intercetta la selezione di un file. Immagine → apre l'editor
 * di scansione; PDF/altro → passa diretto a `onFile`.
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
  const preset: Preset = 'colore'; // sempre "colore migliorato" (selettore rimosso)
  const [src, setSrc] = useState<{ canvas: HTMLCanvasElement; url: string } | null>(null);
  const [corners, setCorners] = useState<Corners | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'working' | 'error'>('loading');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [imgW, setImgW] = useState(0); // larghezza renderizzata dell'immagine (per la scala)
  const imgRef = useRef<HTMLImageElement | null>(null);
  const syncImgW = () => {
    if (imgRef.current) setImgW(imgRef.current.clientWidth);
  };
  const dragging = useRef<HandleKey | null>(null);

  // Carica l'immagine e rende l'editor SUBITO usabile (ritaglio manuale).
  // L'auto-detect dei bordi gira nel Web Worker (OpenCV fuori dal main thread):
  // la UI non si blocca mai.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setStatus('loading');
      setErrorMsg(null);
      let canvas: HTMLCanvasElement;
      try {
        canvas = await imageFileToCanvas(file);
      } catch {
        if (!cancelled) {
          setStatus('error');
          setErrorMsg('Immagine non leggibile.');
        }
        return;
      }
      if (cancelled) return;
      setSrc({ canvas, url: canvas.toDataURL('image/jpeg', 0.92) });
      setCorners(boundsCorners(canvas.width, canvas.height));
      setStatus('ready');

      // Auto-detect bordi DISABILITATO temporaneamente: la pipeline
      // findPaperContour (Canny/findContours/minAreaRect) si bloccava nel worker.
      // Si parte dagli angoli ai bordi e si ritaglia a mano; il raddrizzamento
      // (warp) avviene comunque nel worker alla Conferma.
    })();
    return () => {
      cancelled = true;
    };
  }, [file]);

  // Ricalcola la scala quando la finestra cambia dimensione.
  useEffect(() => {
    const onResize = () => {
      if (imgRef.current) setImgW(imgRef.current.clientWidth);
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const scale = src && imgW ? imgW / src.canvas.width : 1;

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
    await new Promise((r) => setTimeout(r, 30));
    try {
      const ctx = src.canvas.getContext('2d')!;
      const imageData = ctx.getImageData(0, 0, src.canvas.width, src.canvas.height);
      const outW = Math.max(
        1,
        Math.round(Math.max(dist(corners.topLeftCorner, corners.topRightCorner), dist(corners.bottomLeftCorner, corners.bottomRightCorner))),
      );
      const outH = Math.max(
        1,
        Math.round(Math.max(dist(corners.topLeftCorner, corners.bottomLeftCorner), dist(corners.topRightCorner, corners.bottomRightCorner))),
      );
      const result = await warpImage(imageData, corners, outW, outH, preset);
      const out = document.createElement('canvas');
      out.width = result.width;
      out.height = result.height;
      out.getContext('2d')!.putImageData(result, 0, 0);
      const fileOut = await canvasToJpegFile(out, file.name);
      onConfirm(fileOut);
    } catch {
      setStatus('ready');
      setErrorMsg('Elaborazione fallita: puoi caricare l’originale o riprovare.');
    }
  };

  const handlePx = (p: Pt) => ({ left: p.x * scale, top: p.y * scale });

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-pv-navy-900/90 p-3">
      <div className="flex h-[90vh] w-[95vw] flex-col overflow-hidden rounded-[16px] bg-white sm:w-[60vw]">
        <div className="flex items-center justify-between border-b border-pv-slate-200 px-4 py-3">
          <h2 className="text-[15px] font-bold text-pv-navy-900">Ritaglia e migliora</h2>
          <button onClick={onCancel} className="text-[13px] font-semibold text-pv-slate-500 hover:text-pv-navy-800">
            Annulla
          </button>
        </div>

        {errorMsg && (
          <div className="px-4 pt-3">
            <Alert variant="warning">{errorMsg}</Alert>
          </div>
        )}

        <div
          className="flex min-h-0 flex-1 items-center justify-center overflow-hidden p-3"
          onPointerMove={onPointerMove}
          onPointerUp={() => (dragging.current = null)}
          onPointerLeave={() => (dragging.current = null)}
        >
          {status === 'loading' && !src ? (
            <p className="text-[13px] text-pv-slate-500">Caricamento immagine…</p>
          ) : src ? (
            <div className="relative select-none touch-none">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                ref={imgRef}
                src={src.url}
                alt="documento"
                onLoad={syncImgW}
                draggable={false}
                className="block object-contain max-h-[calc(90vh-9rem)] max-w-[88vw] sm:max-w-[calc(60vw-3rem)]"
              />
              {corners && (
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
                        className="absolute h-7 w-7 -translate-x-1/2 -translate-y-1/2 cursor-grab touch-none rounded-full border-2 border-pv-orange-500 bg-white/80 shadow"
                        style={{ left: p.left, top: p.top }}
                      />
                    );
                  })}
                </>
              )}
            </div>
          ) : null}
        </div>

        <div className="flex flex-col gap-2 border-t border-pv-slate-200 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <button
            onClick={rotate}
            disabled={!src || status === 'working'}
            className="inline-flex items-center justify-center gap-1.5 rounded-[10px] border border-pv-slate-200 px-3 py-2 text-[13px] font-semibold text-pv-navy-700 transition hover:border-pv-navy-400 disabled:opacity-50"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M21 12a9 9 0 1 1-2.64-6.36" />
              <path d="M21 3v5h-5" />
            </svg>
            Ruota
          </button>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => onConfirm(file)} disabled={status === 'working'}>
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
