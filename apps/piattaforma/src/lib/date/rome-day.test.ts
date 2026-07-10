import { describe, expect, it } from 'vitest';
import { parseYmd, romeStartOfDay, romeEndOfDay, resolveDayRange } from './rome-day';

describe('parseYmd', () => {
  it('accetta una data di calendario valida', () => {
    expect(parseYmd('2026-07-15')).toEqual([2026, 7, 15]);
  });
  it('rifiuta undefined, formati errati e date impossibili', () => {
    expect(parseYmd(undefined)).toBeNull();
    expect(parseYmd('15/07/2026')).toBeNull();
    expect(parseYmd('2026-02-30')).toBeNull();
    expect(parseYmd('2026-13-01')).toBeNull();
  });
});

describe('romeStartOfDay / romeEndOfDay (Europe/Rome, DST)', () => {
  it('estate CEST (+2)', () => {
    expect(romeStartOfDay([2026, 7, 15]).toISOString()).toBe('2026-07-14T22:00:00.000Z');
    expect(romeEndOfDay([2026, 7, 20]).toISOString()).toBe('2026-07-20T21:59:59.999Z');
  });
  it('inverno CET (+1)', () => {
    expect(romeStartOfDay([2026, 1, 15]).toISOString()).toBe('2026-01-14T23:00:00.000Z');
  });
  it('giorno di spring-forward (29/03/2026)', () => {
    expect(romeStartOfDay([2026, 3, 29]).toISOString()).toBe('2026-03-28T23:00:00.000Z');
    expect(romeEndOfDay([2026, 3, 29]).toISOString()).toBe('2026-03-29T21:59:59.999Z');
  });
  it('giorno di fall-back (25/10/2026)', () => {
    expect(romeStartOfDay([2026, 10, 25]).toISOString()).toBe('2026-10-24T22:00:00.000Z');
    expect(romeEndOfDay([2026, 10, 25]).toISOString()).toBe('2026-10-25T22:59:59.999Z');
  });
});

describe('resolveDayRange', () => {
  it('da+a validi: bound + echo + active', () => {
    const r = resolveDayRange('2026-07-15', '2026-07-20');
    expect(r.gte?.toISOString()).toBe('2026-07-14T22:00:00.000Z');
    expect(r.lte?.toISOString()).toBe('2026-07-20T21:59:59.999Z');
    expect(r.da).toBe('2026-07-15');
    expect(r.a).toBe('2026-07-20');
    expect(r.active).toBe(true);
  });
  it('solo da: nessun lte', () => {
    const r = resolveDayRange('2026-07-15', undefined);
    expect(r.gte?.toISOString()).toBe('2026-07-14T22:00:00.000Z');
    expect(r.lte).toBeUndefined();
    expect(r.da).toBe('2026-07-15');
    expect(r.a).toBe('');
    expect(r.active).toBe(true);
  });
  it('vuoto o malformato: inattivo, nessun bound', () => {
    const r = resolveDayRange(undefined, '31/12/2026');
    expect(r.gte).toBeUndefined();
    expect(r.lte).toBeUndefined();
    expect(r.da).toBe('');
    expect(r.a).toBe('');
    expect(r.active).toBe(false);
  });
});
