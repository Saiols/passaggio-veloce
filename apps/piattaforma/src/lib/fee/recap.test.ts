import { describe, it, expect } from 'vitest';
import { groupFeeByMonth, type FeeRow } from './recap';

const rows: FeeRow[] = [
  { importoCent: 2500, stato: 'SUCCESS', refDate: new Date('2026-05-10T00:00:00Z') },
  { importoCent: 2500, stato: 'SCHEDULED', refDate: new Date('2026-05-20T00:00:00Z') },
  { importoCent: 1500, stato: 'FAILED', refDate: new Date('2026-04-03T00:00:00Z') },
];

describe('groupFeeByMonth', () => {
  it('groups rows by YYYY-MM descending with totals', () => {
    const groups = groupFeeByMonth(rows);
    expect(groups.map((g) => g.month)).toEqual(['2026-05', '2026-04']);
    expect(groups[0].totaleCent).toBe(5000);
    expect(groups[0].rows).toHaveLength(2);
    expect(groups[1].totaleCent).toBe(1500);
  });
  it('returns empty array for no rows', () => {
    expect(groupFeeByMonth([])).toEqual([]);
  });
});
