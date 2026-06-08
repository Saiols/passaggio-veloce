'use client';

// Helper per lo scanner documenti. Le parti PURE (riconoscimento tipo, calcolo
// dimensioni, naming) sono unit-testate; le parti canvas/DOM sono usate dal
// modal e verificate manualmente (richiedono un ambiente browser reale).

export const SCANNER_ACCEPTED_MIME = ['image/jpeg', 'image/png'];
export type Preset = 'originale' | 'colore' | 'bn';

/** True se il file è un'immagine gestita dall'editor (PDF e altri bypassano). */
export function isImageFile(f: File): boolean {
  return SCANNER_ACCEPTED_MIME.includes(f.type);
}

/** Dimensioni scalate al lato massimo, proporzioni invariate; sotto soglia resta uguale. */
export function scaledSize(w: number, h: number, maxSide: number): { w: number; h: number } {
  const longest = Math.max(w, h);
  if (longest <= maxSide) return { w, h };
  const k = maxSide / longest;
  return { w: Math.round(w * k), h: Math.round(h * k) };
}

/** Nome file di output: conserva il nome, forza estensione .jpg. */
export function outputFileName(name: string): string {
  return `${name.replace(/\.[^.]+$/, '')}.jpg`;
}

/** Decodifica un File immagine in un canvas, downscalato se troppo grande. */
export async function imageFileToCanvas(file: File, maxSide = 2500): Promise<HTMLCanvasElement> {
  const bitmap = await createImageBitmap(file);
  const { w, h } = scaledSize(bitmap.width, bitmap.height, maxSide);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  return canvas;
}

/** Canvas → File JPEG, ricomprimendo finché sotto `maxBytes`. */
export async function canvasToJpegFile(
  canvas: HTMLCanvasElement,
  name: string,
  maxBytes = 10 * 1024 * 1024,
): Promise<File> {
  let quality = 0.92;
  let blob = await toBlob(canvas, quality);
  while (blob.size > maxBytes && quality > 0.4) {
    quality -= 0.15;
    blob = await toBlob(canvas, quality);
  }
  return new File([blob], outputFileName(name), { type: 'image/jpeg' });
}

function toBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('canvas.toBlob() ha restituito null'))),
      'image/jpeg',
      quality,
    ),
  );
}
