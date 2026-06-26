'use client';

/** True se il file è un PDF (mime o estensione). */
export function isPdfFile(f: File): boolean {
  return f.type === 'application/pdf' || /\.pdf$/i.test(f.name);
}

/** Indice pagina valido entro [0, count-1]; count<=0 → 0. */
export function clampPageIndex(index: number, count: number): number {
  if (count <= 0) return 0;
  return Math.max(0, Math.min(index, count - 1));
}

/** Carica pdfjs e configura il worker (lazy import per evitare problemi in Node/test). */
async function loadPdfjs() {
  const pdfjs = await import('pdfjs-dist');
  // Worker pdf.js servito come modulo separato (Next 16 / webpack).
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.min.mjs',
    import.meta.url,
  ).toString();
  return pdfjs;
}

/** Numero di pagine del PDF. */
export async function pdfPageCount(file: File): Promise<number> {
  const pdfjs = await loadPdfjs();
  const data = new Uint8Array(await file.arrayBuffer());
  const task = pdfjs.getDocument({ data });
  const doc = await task.promise;
  const n = doc.numPages;
  await task.destroy();
  return n;
}

/** Renderizza una pagina del PDF su canvas (scala default 2x per il ritaglio). */
export async function renderPdfPage(
  file: File,
  pageIndex = 0,
  scale = 2,
): Promise<HTMLCanvasElement> {
  const pdfjs = await loadPdfjs();
  const data = new Uint8Array(await file.arrayBuffer());
  const task = pdfjs.getDocument({ data });
  const doc = await task.promise;
  try {
    const page = await doc.getPage(clampPageIndex(pageIndex, doc.numPages) + 1);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    await page.render({ canvas, viewport }).promise;
    return canvas;
  } finally {
    await task.destroy();
  }
}
