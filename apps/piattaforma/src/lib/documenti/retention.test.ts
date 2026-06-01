import { describe, it, expect } from 'vitest';
import { cutoffDate, DOC_HARD_DELETE_DAYS, BOZZA_PURGE_DAYS } from './retention';

describe('retention constants', () => {
  it('uses 90gg per documenti e 30gg per bozze', () => {
    expect(DOC_HARD_DELETE_DAYS).toBe(90);
    expect(BOZZA_PURGE_DAYS).toBe(30);
  });
});

describe('cutoffDate', () => {
  it('returns now minus N days', () => {
    const now = new Date('2026-06-01T00:00:00.000Z');
    expect(cutoffDate(30, now).toISOString()).toBe('2026-05-02T00:00:00.000Z');
  });
});
