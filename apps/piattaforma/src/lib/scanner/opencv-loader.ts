'use client';
/* eslint-disable @typescript-eslint/no-explicit-any */

// Carica OpenCV.js (npm @techstark/opencv-js) una sola volta, in modo lazy: il
// chunk (~8 MB) viene code-splittato da Next e scaricato solo alla prima
// chiamata (apertura dell'editor). Espone l'istanza come `globalThis.cv`,
// richiesto da jscanify (build browser). Servito dal nostro dominio: nessun CDN.
let promise: Promise<any> | null = null;

export function loadOpenCv(): Promise<any> {
  if (promise) return promise;
  promise = (async () => {
    const mod: any = await import('@techstark/opencv-js');
    const cv: any = mod?.default ?? mod;
    if (!cv?.Mat) {
      await new Promise<void>((resolve, reject) => {
        const start = Date.now();
        const poll = () => {
          if (cv?.Mat) return resolve();
          if (Date.now() - start > 30000) return reject(new Error('OpenCV init timeout'));
          setTimeout(poll, 50);
        };
        // @techstark segnala il runtime wasm pronto via onRuntimeInitialized…
        if (typeof cv?.onRuntimeInitialized !== 'undefined') {
          cv.onRuntimeInitialized = () => resolve();
        }
        poll(); // …ma facciamo anche polling (se è già pronto la callback non scatta)
      });
    }
    (globalThis as any).cv = cv;
    return cv;
  })();
  return promise;
}
