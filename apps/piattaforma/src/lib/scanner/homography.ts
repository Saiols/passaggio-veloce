// Omografia (trasformazione prospettica) 3x3 da 4 corrispondenze di punti.
// Puro/testabile, niente dipendenze. Usato dal worker per raddrizzare il
// documento senza OpenCV.

export type Point = { x: number; y: number };

/**
 * Calcola la matrice prospettica H (9 valori, row-major, h22=1) che mappa i 4
 * punti `from` nei 4 punti `to`. Risolve il sistema lineare 8x8 con
 * eliminazione di Gauss (pivot parziale).
 */
export function getPerspectiveTransform(from: Point[], to: Point[]): number[] {
  const a: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = from[i]!;
    const { x: u, y: v } = to[i]!;
    a.push([x, y, 1, 0, 0, 0, -x * u, -y * u]);
    b.push(u);
    a.push([0, 0, 0, x, y, 1, -x * v, -y * v]);
    b.push(v);
  }
  const h = solve8(a, b);
  return [h[0]!, h[1]!, h[2]!, h[3]!, h[4]!, h[5]!, h[6]!, h[7]!, 1];
}

/** Applica H a un punto (x,y) → punto trasformato. */
export function mapPoint(h: number[], x: number, y: number): Point {
  const d = h[6]! * x + h[7]! * y + h[8]!;
  return {
    x: (h[0]! * x + h[1]! * y + h[2]!) / d,
    y: (h[3]! * x + h[4]! * y + h[5]!) / d,
  };
}

/** Risolve A·x = b con A 8x8, b lunghezza 8 (Gauss + pivot parziale). */
function solve8(A: number[][], b: number[]): number[] {
  const n = 8;
  // matrice aumentata
  const m = A.map((row, i) => [...row, b[i]!]);
  for (let col = 0; col < n; col++) {
    // pivot parziale
    let pivot = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(m[r]![col]!) > Math.abs(m[pivot]![col]!)) pivot = r;
    }
    [m[col], m[pivot]] = [m[pivot]!, m[col]!];
    const pv = m[col]![col]!;
    if (Math.abs(pv) < 1e-12) continue; // degenerato: salta
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = m[r]![col]! / pv;
      if (f === 0) continue;
      for (let c = col; c <= n; c++) m[r]![c]! -= f * m[col]![c]!;
    }
  }
  const x = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    const d = m[i]![i]!;
    x[i] = Math.abs(d) < 1e-12 ? 0 : m[i]![n]! / d;
  }
  return x;
}
