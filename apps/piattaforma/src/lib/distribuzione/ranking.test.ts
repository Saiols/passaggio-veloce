import { describe, it, expect } from 'vitest';
import {
  effectiveScore,
  rankCandidates,
  type AgenziaRankedLike,
} from './ranking-util';

const baseAgenzia = (
  overrides: Partial<AgenziaRankedLike> = {},
): AgenziaRankedLike => ({
  id: 'a1',
  createdAt: new Date('2026-01-01'),
  ratingAvg: 4.0,
  ratingCount: 10,
  ranked: true,
  sospesa: false,
  recentRejects: 0,
  ...overrides,
});

describe('effectiveScore', () => {
  it('returns ratingAvg when no recent rejects', () => {
    expect(effectiveScore({ ratingAvg: 4.0, recentRejects: 0 })).toBe(4.0);
  });

  it('subtracts decay per consecutive reject', () => {
    // 3 rifiuti consecutivi → score effettivo = 4.0 − 0.6 = 3.4
    expect(effectiveScore({ ratingAvg: 4.0, recentRejects: 3 })).toBeCloseTo(3.4);
  });

  it('handles null ratingAvg as 0', () => {
    expect(effectiveScore({ ratingAvg: null, recentRejects: 2 })).toBeCloseTo(-0.4);
  });
});

describe('rankCandidates', () => {
  it('puts ranked agenzie before non-ranked', () => {
    const a = baseAgenzia({ id: 'a', ranked: true, ratingAvg: 3.5 });
    const b = baseAgenzia({ id: 'b', ranked: false, ratingAvg: null, ratingCount: 0 });
    const out = rankCandidates([b, a]);
    expect(out.map((x) => x.id)).toEqual(['a', 'b']);
  });

  it('orders ranked by effectiveScore desc (decay applies)', () => {
    const a = baseAgenzia({ id: 'a', ratingAvg: 4.5, recentRejects: 0 });
    const b = baseAgenzia({ id: 'b', ratingAvg: 4.0, recentRejects: 0 });
    const c = baseAgenzia({ id: 'c', ratingAvg: 4.8, recentRejects: 4 }); // → 4.0
    const out = rankCandidates([a, b, c]);
    expect(out.map((x) => x.id)).toEqual(['a', 'b', 'c']);
  });

  it('agenzia con tanti rifiuti scivola sotto agenzia con score più basso ma onesta', () => {
    const onesta = baseAgenzia({ id: 'onesta', ratingAvg: 3.5, recentRejects: 0 });
    const abusiva = baseAgenzia({ id: 'abusiva', ratingAvg: 4.5, recentRejects: 6 }); // → 3.3
    const out = rankCandidates([abusiva, onesta]);
    expect(out.map((x) => x.id)).toEqual(['onesta', 'abusiva']);
  });

  it('exclude sospese', () => {
    const ok = baseAgenzia({ id: 'ok' });
    const sospesa = baseAgenzia({ id: 'sosp', sospesa: true });
    const out = rankCandidates([ok, sospesa]);
    expect(out.map((x) => x.id)).toEqual(['ok']);
  });
});
