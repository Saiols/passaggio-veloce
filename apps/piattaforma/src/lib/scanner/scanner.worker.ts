/* eslint-disable @typescript-eslint/no-explicit-any */
// Web Worker: TUTTE le operazioni OpenCV (init runtime ~8 MB, detect bordi,
// warp prospettico, filtri) girano QUI, fuori dal main thread → la UI non si
// blocca mai ("pagina non risponde"). Comunica via postMessage con ImageData.
// jscanify usa il DOM (document/cv.imread su elementi) e non gira in un worker:
// le sue funzioni findPaperContour/getCornerPoints sono portate a OpenCV raw.

import cvModule from '@techstark/opencv-js';

type Pt = { x: number; y: number };
type Corners = {
  topLeftCorner: Pt;
  topRightCorner: Pt;
  bottomRightCorner: Pt;
  bottomLeftCorner: Pt;
};

let cv: any = null;

async function getCv(): Promise<any> {
  if (cv) return cv;
  const c: any = (cvModule as any)?.default ?? cvModule;
  console.log('[worker] getCv: modulo importato, cv.Mat?', !!c?.Mat);
  if (!c?.Mat) {
    await new Promise<void>((resolve, reject) => {
      const start = Date.now();
      let ticks = 0;
      const poll = () => {
        if (c?.Mat) {
          console.log('[worker] getCv: runtime pronto dopo', Date.now() - start, 'ms');
          return resolve();
        }
        if (Date.now() - start > 60000) return reject(new Error('OpenCV init timeout'));
        if (++ticks % 40 === 0) console.log('[worker] getCv: attendo runtime…', Date.now() - start, 'ms');
        setTimeout(poll, 50);
      };
      if (typeof c?.onRuntimeInitialized !== 'undefined') c.onRuntimeInitialized = () => resolve();
      poll();
    });
  }
  cv = c;
  return cv;
}

function distance(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(ax - bx, ay - by);
}

// Porting di jscanify.findPaperContour (OpenCV raw, niente DOM).
function findPaperContour(img: any): any {
  const gray = new cv.Mat();
  cv.Canny(img, gray, 50, 200);
  const blur = new cv.Mat();
  cv.GaussianBlur(gray, blur, new cv.Size(3, 3), 0, 0, cv.BORDER_DEFAULT);
  const thresh = new cv.Mat();
  cv.threshold(blur, thresh, 0, 255, cv.THRESH_OTSU);
  const contours = new cv.MatVector();
  const hierarchy = new cv.Mat();
  cv.findContours(thresh, contours, hierarchy, cv.RETR_CCOMP, cv.CHAIN_APPROX_SIMPLE);
  let maxArea = 0;
  let maxIdx = -1;
  for (let i = 0; i < contours.size(); ++i) {
    const a = cv.contourArea(contours.get(i));
    if (a > maxArea) {
      maxArea = a;
      maxIdx = i;
    }
  }
  // IMPORTANTE: clona il contorno PRIMA di liberare il MatVector. `contours.get(i)`
  // condivide memoria col vector: dopo `contours.delete()` leggere `data32S`
  // restituirebbe memoria liberata (length spazzatura → for loop infinito).
  const maxContour = maxIdx >= 0 ? contours.get(maxIdx).clone() : null;
  gray.delete();
  blur.delete();
  thresh.delete();
  contours.delete();
  hierarchy.delete();
  return maxContour;
}

// Porting di jscanify.getCornerPoints.
function getCornerPoints(contour: any): Corners | null {
  const rect = cv.minAreaRect(contour);
  const cx = rect.center.x;
  const cy = rect.center.y;
  let tl: Pt | undefined, tr: Pt | undefined, bl: Pt | undefined, br: Pt | undefined;
  let tlD = 0, trD = 0, blD = 0, brD = 0;
  const data = contour.data32S as Int32Array;
  for (let i = 0; i < data.length; i += 2) {
    const x = data[i]!;
    const y = data[i + 1]!;
    const d = distance(x, y, cx, cy);
    if (x < cx && y < cy) {
      if (d > tlD) { tl = { x, y }; tlD = d; }
    } else if (x > cx && y < cy) {
      if (d > trD) { tr = { x, y }; trD = d; }
    } else if (x < cx && y > cy) {
      if (d > blD) { bl = { x, y }; blD = d; }
    } else if (x > cx && y > cy) {
      if (d > brD) { br = { x, y }; brD = d; }
    }
  }
  if (!tl || !tr || !bl || !br) return null;
  return { topLeftCorner: tl, topRightCorner: tr, bottomRightCorner: br, bottomLeftCorner: bl };
}

function detect(imageData: ImageData): Corners | null {
  const img = cv.matFromImageData(imageData);
  let corners: Corners | null = null;
  const contour = findPaperContour(img);
  if (contour) {
    corners = getCornerPoints(contour);
    contour.delete();
  }
  img.delete();
  return corners;
}

function warp(
  imageData: ImageData,
  corners: Corners,
  outW: number,
  outH: number,
  preset: 'originale' | 'colore' | 'bn',
): ImageData {
  const img = cv.matFromImageData(imageData);
  const srcTri = cv.matFromArray(4, 1, cv.CV_32FC2, [
    corners.topLeftCorner.x, corners.topLeftCorner.y,
    corners.topRightCorner.x, corners.topRightCorner.y,
    corners.bottomLeftCorner.x, corners.bottomLeftCorner.y,
    corners.bottomRightCorner.x, corners.bottomRightCorner.y,
  ]);
  const dstTri = cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, outW, 0, 0, outH, outW, outH]);
  const M = cv.getPerspectiveTransform(srcTri, dstTri);
  const warped = new cv.Mat();
  cv.warpPerspective(img, warped, M, new cv.Size(outW, outH), cv.INTER_LINEAR, cv.BORDER_CONSTANT, new cv.Scalar());

  let finalMat = warped;
  const extra: any[] = [];
  if (preset === 'colore') {
    const adj = new cv.Mat();
    warped.convertTo(adj, -1, 1.18, 12); // contrasto (alpha) + luminosità (beta)
    finalMat = adj;
    extra.push(adj);
  } else if (preset === 'bn') {
    const gray = new cv.Mat();
    cv.cvtColor(warped, gray, cv.COLOR_RGBA2GRAY);
    const th = new cv.Mat();
    cv.adaptiveThreshold(gray, th, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY, 15, 10);
    const rgba = new cv.Mat();
    cv.cvtColor(th, rgba, cv.COLOR_GRAY2RGBA);
    gray.delete();
    th.delete();
    finalMat = rgba;
    extra.push(rgba);
  }

  const out = new ImageData(new Uint8ClampedArray(finalMat.data), finalMat.cols, finalMat.rows);
  img.delete();
  srcTri.delete();
  dstTri.delete();
  M.delete();
  warped.delete();
  for (const m of extra) if (m !== warped) m.delete();
  return out;
}

self.onmessage = async (e: MessageEvent) => {
  const { id, type } = e.data;
  console.log('[worker] ricevuto messaggio', type, id);
  try {
    await getCv();
    if (type === 'detect') {
      const result = detect(e.data.imageData);
      console.log('[worker] detect completato', id);
      (self as any).postMessage({ id, ok: true, result });
    } else if (type === 'warp') {
      console.log('[worker] warp start', id, e.data.outW, 'x', e.data.outH, e.data.preset);
      const result = warp(e.data.imageData, e.data.corners, e.data.outW, e.data.outH, e.data.preset);
      console.log('[worker] warp done', id, result.width, 'x', result.height);
      (self as any).postMessage({ id, ok: true, result }, [result.data.buffer]);
    } else {
      (self as any).postMessage({ id, ok: false, error: `tipo sconosciuto: ${type}` });
    }
  } catch (err: any) {
    console.error('[worker] errore', type, id, err);
    (self as any).postMessage({ id, ok: false, error: String(err?.message ?? err) });
  }
};
