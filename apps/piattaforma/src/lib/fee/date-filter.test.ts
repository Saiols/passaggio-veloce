import { describe, expect, it } from 'vitest';
import { feeRefDateWhere } from './date-filter';

const g = new Date('2026-07-14T22:00:00.000Z');
const l = new Date('2026-07-20T21:59:59.999Z');

describe('feeRefDateWhere', () => {
  it('range vuoto → null', () => {
    expect(feeRefDateWhere({})).toBeNull();
  });
  it('solo gte: filtra refDate ≥ g su scheduledAt o (scheduledAt null → createdAt)', () => {
    expect(feeRefDateWhere({ gte: g })).toEqual({
      OR: [
        { scheduledAt: { gte: g } },
        { AND: [{ scheduledAt: null }, { createdAt: { gte: g } }] },
      ],
    });
  });
  it('gte + lte: entrambi i bound su ciascun ramo', () => {
    expect(feeRefDateWhere({ gte: g, lte: l })).toEqual({
      OR: [
        { scheduledAt: { gte: g, lte: l } },
        { AND: [{ scheduledAt: null }, { createdAt: { gte: g, lte: l } }] },
      ],
    });
  });
});
