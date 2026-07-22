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

export function getWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('./scanner.worker.ts', import.meta.url));
  worker.onmessage = (e: MessageEvent) => {
    const { id, ok, result, error } = e.data;
    const p = pending.get(id);
    if (!p) return;
    pending.delete(id);
    if (ok) p.resolve(result);
    else p.reject(new Error(error ?? 'scanner worker error'));
  };
  worker.onerror = (e) => {
    for (const [, p] of pending) p.reject(new Error(e.message || 'scanner worker crashed'));
    pending.clear();
    // Auto-heal: se il worker notifica un crash, il prossimo getWorker() ne
    // creerà uno fresco invece di riusare quello morto.
    worker = null;
  };
  return worker;
}

/**
 * Termina il worker corrente e ne forza la ricreazione (lazy) al prossimo uso.
 * Rigetta subito le pending, così un modale in attesa non resta appeso fino al
 * timeout. Idempotente (no-op se il worker non esiste).
 */
export function disposeWorker(): void {
  if (!worker) return;
  try {
    worker.terminate();
  } catch {
    // worker già morto: ignora
  }
  worker = null;
  for (const [, p] of pending) p.reject(new Error('scanner riavviato'));
  pending.clear();
}

// iOS Safari TERMINA i Web Worker quando la pagina va in background: al ritorno
// in foreground (o da bfcache) il singleton `worker` punterebbe a un worker
// morto e ogni postMessage cadrebbe nel vuoto → il modale scanner resta in
// "Elaborazione…" fino al timeout, sbloccabile solo chiudendo e riaprendo la
// tab (fresh JS → worker nuovo). Quando la pagina torna visibile buttiamo il
// worker: la ricreazione è lazy (getWorker), quindi costo nullo se non si
// scannerizza. Guardia SSR (typeof window).
if (typeof window !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') disposeWorker();
  });
  window.addEventListener('pageshow', (e) => {
    if ((e as PageTransitionEvent).persisted) disposeWorker();
  });
}

function call<T>(type: string, payload: Record<string, unknown>, transfer: Transferable[] = []): Promise<T> {
  const w = getWorker();
  const id = ++seq;
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      if (pending.delete(id)) {
        reject(new Error(`scanner timeout (${type})`));
      }
    }, 60000);
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

// Niente transfer dell'ImageData: lo passiamo per copia (structured clone).

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
