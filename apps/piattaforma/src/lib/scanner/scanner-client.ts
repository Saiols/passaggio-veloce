'use client';

// Wrapper main-thread del Web Worker OpenCV: nessun OpenCV gira qui. Crea il
// worker on-demand (singleton) e correla richieste/risposte per id.

export type Pt = { x: number; y: number };
export type Corners = {
  topLeftCorner: Pt;
  topRightCorner: Pt;
  bottomRightCorner: Pt;
  bottomLeftCorner: Pt;
};
export type Preset = 'originale' | 'colore' | 'bn';

let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

function getWorker(): Worker {
  if (worker) return worker;
  console.log('[scanner] creo worker');
  worker = new Worker(new URL('./scanner.worker.ts', import.meta.url));
  worker.onmessage = (e: MessageEvent) => {
    const { id, ok, result, error } = e.data;
    console.log('[scanner] ← risposta', id, 'ok=', ok);
    const p = pending.get(id);
    if (!p) return;
    pending.delete(id);
    if (ok) p.resolve(result);
    else p.reject(new Error(error ?? 'scanner worker error'));
  };
  worker.onerror = (e) => {
    console.error('[scanner] worker.onerror', e.message, e);
    for (const [, p] of pending) p.reject(new Error(e.message || 'scanner worker crashed'));
    pending.clear();
  };
  worker.onmessageerror = (e) => {
    console.error('[scanner] worker.onmessageerror', e);
  };
  return worker;
}

function call<T>(type: string, payload: Record<string, unknown>, transfer: Transferable[] = []): Promise<T> {
  const w = getWorker();
  const id = ++seq;
  console.log('[scanner] → invio', type, id, 'transfer=', transfer.length);
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      if (pending.delete(id)) {
        console.error('[scanner] timeout', type, id);
        reject(new Error(`scanner timeout (${type})`));
      }
    }, 120000);
    pending.set(id, {
      resolve: (v) => {
        clearTimeout(timer);
        (resolve as (v: unknown) => void)(v);
      },
      reject: (err) => {
        clearTimeout(timer);
        reject(err);
      },
    });
    w.postMessage({ id, type, ...payload }, transfer);
  });
}

// Niente transfer dell'ImageData: lo passiamo per copia (structured clone). È un
// filo più lento ma esclude problemi di buffer detached/transferable nel worker.

/** Rileva i 4 angoli del documento. Ritorna null se non rilevato. */
export function detectCorners(imageData: ImageData): Promise<Corners | null> {
  return call<Corners | null>('detect', { imageData });
}

/** Raddrizza (dewarp) + applica il preset. Ritorna l'ImageData elaborata. */
export function warpImage(
  imageData: ImageData,
  corners: Corners,
  outW: number,
  outH: number,
  preset: Preset,
): Promise<ImageData> {
  return call<ImageData>('warp', { imageData, corners, outW, outH, preset });
}
