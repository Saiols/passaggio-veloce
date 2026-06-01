import { describe, it, expect } from 'vitest';
import { computeGiorniResidui, countdownLevel } from './countdown';

describe('computeGiorniResidui', () => {
  const now = new Date('2026-06-01T10:00:00.000Z');
  it('returns null when no date', () => {
    expect(computeGiorniResidui(null, now)).toBeNull();
  });
  it('counts whole days remaining (ceil)', () => {
    expect(computeGiorniResidui(new Date('2026-06-06T09:00:00.000Z'), now)).toBe(5);
  });
  it('returns 1 within the final day', () => {
    expect(computeGiorniResidui(new Date('2026-06-01T18:00:00.000Z'), now)).toBe(1);
  });
  it('returns negative when overdue', () => {
    expect(computeGiorniResidui(new Date('2026-05-30T10:00:00.000Z'), now)).toBe(-2);
  });
});

describe('countdownLevel', () => {
  it('classifies by days remaining', () => {
    expect(countdownLevel(10)).toBe('ok');
    expect(countdownLevel(5)).toBe('warn');
    expect(countdownLevel(2)).toBe('urgent');
    expect(countdownLevel(0)).toBe('urgent');
    expect(countdownLevel(-1)).toBe('overdue');
    expect(countdownLevel(null)).toBe('none');
  });
});
