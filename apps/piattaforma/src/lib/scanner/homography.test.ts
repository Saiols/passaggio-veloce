import { describe, it, expect } from 'vitest';
import { getPerspectiveTransform, mapPoint, type Point } from './homography';

const sq: Point[] = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
];

describe('homography', () => {
  it('scala 2x: mappa il quadrato unitario su 2x2', () => {
    const to: Point[] = [
      { x: 0, y: 0 },
      { x: 2, y: 0 },
      { x: 2, y: 2 },
      { x: 0, y: 2 },
    ];
    const h = getPerspectiveTransform(sq, to);
    expect(mapPoint(h, 0.5, 0.5).x).toBeCloseTo(1, 6);
    expect(mapPoint(h, 0.5, 0.5).y).toBeCloseTo(1, 6);
    // gli angoli combaciano
    for (let i = 0; i < 4; i++) {
      const p = mapPoint(h, sq[i]!.x, sq[i]!.y);
      expect(p.x).toBeCloseTo(to[i]!.x, 6);
      expect(p.y).toBeCloseTo(to[i]!.y, 6);
    }
  });

  it('trapezio → rettangolo: i 4 angoli mappano esattamente', () => {
    const trap: Point[] = [
      { x: 20, y: 10 },
      { x: 180, y: 30 },
      { x: 160, y: 190 },
      { x: 5, y: 150 },
    ];
    const rect: Point[] = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 120 },
      { x: 0, y: 120 },
    ];
    const h = getPerspectiveTransform(rect, trap); // dst(rect) → src(trap)
    for (let i = 0; i < 4; i++) {
      const p = mapPoint(h, rect[i]!.x, rect[i]!.y);
      expect(p.x).toBeCloseTo(trap[i]!.x, 4);
      expect(p.y).toBeCloseTo(trap[i]!.y, 4);
    }
  });
});
