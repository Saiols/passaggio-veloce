/* eslint-disable @typescript-eslint/no-explicit-any */
// Web Worker SENZA OpenCV: raddrizzamento prospettico (omografia + campionamento
// bilineare) e filtri in puro JavaScript su ImageData. Off-main-thread → niente
// freeze; niente wasm → niente problemi di runtime/readiness.

import { getPerspectiveTransform, mapPoint, type Point } from './homography';

type Corners = {
  topLeftCorner: Point;
  topRightCorner: Point;
  bottomRightCorner: Point;
  bottomLeftCorner: Point;
};
type Preset = 'originale' | 'colore' | 'bn';

const MAX_OUT_SIDE = 2000;

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function warp(
  src: ImageData,
  corners: Corners,
  outWReq: number,
  outHReq: number,
  preset: Preset,
): ImageData {
  // Cap dimensioni output (perf/memoria), proporzioni invariate.
  let outW = Math.max(1, Math.round(outWReq));
  let outH = Math.max(1, Math.round(outHReq));
  const mx = Math.max(outW, outH);
  if (mx > MAX_OUT_SIDE) {
    const k = MAX_OUT_SIDE / mx;
    outW = Math.max(1, Math.round(outW * k));
    outH = Math.max(1, Math.round(outH * k));
  }

  // H mappa il rettangolo di destinazione → quadrilatero sorgente (inverse map).
  const dstRect: Point[] = [
    { x: 0, y: 0 },
    { x: outW, y: 0 },
    { x: outW, y: outH },
    { x: 0, y: outH },
  ];
  const srcQuad: Point[] = [
    corners.topLeftCorner,
    corners.topRightCorner,
    corners.bottomRightCorner,
    corners.bottomLeftCorner,
  ];
  const h = getPerspectiveTransform(dstRect, srcQuad);

  const sw = src.width;
  const sh = src.height;
  const sd = src.data;
  const out = new Uint8ClampedArray(outW * outH * 4);

  for (let dy = 0; dy < outH; dy++) {
    for (let dx = 0; dx < outW; dx++) {
      const p = mapPoint(h, dx + 0.5, dy + 0.5);
      const sx = clamp(p.x, 0, sw - 1);
      const sy = clamp(p.y, 0, sh - 1);
      const x0 = Math.floor(sx);
      const y0 = Math.floor(sy);
      const x1 = x0 + 1 < sw ? x0 + 1 : x0;
      const y1 = y0 + 1 < sh ? y0 + 1 : y0;
      const fx = sx - x0;
      const fy = sy - y0;
      const i00 = (y0 * sw + x0) * 4;
      const i10 = (y0 * sw + x1) * 4;
      const i01 = (y1 * sw + x0) * 4;
      const i11 = (y1 * sw + x1) * 4;
      const o = (dy * outW + dx) * 4;
      for (let c = 0; c < 3; c++) {
        const top = sd[i00 + c]! + (sd[i10 + c]! - sd[i00 + c]!) * fx;
        const bot = sd[i01 + c]! + (sd[i11 + c]! - sd[i01 + c]!) * fx;
        out[o + c] = top + (bot - top) * fy;
      }
      out[o + 3] = 255;
    }
  }

  applyPreset(out, outW, outH, preset);
  return new ImageData(out, outW, outH);
}

function applyPreset(data: Uint8ClampedArray, w: number, h: number, preset: Preset): void {
  if (preset === 'originale') return;
  if (preset === 'colore') {
    // contrasto 1.18 + luminosità +12
    for (let i = 0; i < data.length; i += 4) {
      for (let c = 0; c < 3; c++) {
        data[i + c] = clamp((data[i + c]! - 128) * 1.18 + 128 + 12, 0, 255);
      }
    }
    return;
  }
  // bn: grayscale + soglia di Otsu (look "scansione")
  const n = w * h;
  const gray = new Uint8ClampedArray(n);
  const hist = new Array<number>(256).fill(0);
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    const g = (data[i]! * 0.299 + data[i + 1]! * 0.587 + data[i + 2]! * 0.114) | 0;
    gray[p] = g;
    hist[g]!++;
  }
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i]!;
  let sumB = 0, wB = 0, maxVar = -1, thresh = 127;
  for (let i = 0; i < 256; i++) {
    wB += hist[i]!;
    if (wB === 0) continue;
    const wF = n - wB;
    if (wF === 0) break;
    sumB += i * hist[i]!;
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > maxVar) {
      maxVar = between;
      thresh = i;
    }
  }
  for (let p = 0, i = 0; p < n; p++, i += 4) {
    const v = gray[p]! > thresh ? 255 : 0;
    data[i] = v;
    data[i + 1] = v;
    data[i + 2] = v;
    data[i + 3] = 255;
  }
}

self.onmessage = (e: MessageEvent) => {
  const { id, type } = e.data;
  try {
    if (type === 'warp') {
      const result = warp(e.data.imageData, e.data.corners, e.data.outW, e.data.outH, e.data.preset);
      (self as any).postMessage({ id, ok: true, result });
    } else {
      (self as any).postMessage({ id, ok: false, error: `tipo sconosciuto: ${type}` });
    }
  } catch (err: any) {
    (self as any).postMessage({ id, ok: false, error: String(err?.message ?? err) });
  }
};
