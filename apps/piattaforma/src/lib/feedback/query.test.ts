import { describe, expect, it } from 'vitest';
import { resolveFeedbackFilters } from './query';

const base = { agenziaId: 'c1', scopeIds: ['s1', 's2'], accessibleSedeIds: ['s1', 's2'] };

describe('resolveFeedbackFilters — scope base', () => {
  it('owner senza filtri: aggregato su tutta la madre', () => {
    const r = resolveFeedbackFilters({ ...base, isOwner: true, params: {} });
    expect(r.where).toEqual({ agenziaId: 'c1' });
    expect(r.attivi).toBe(false);
    expect(r.sede).toBe('');
  });

  it('non-owner senza filtri: solo le sedi in scope (invariato)', () => {
    const r = resolveFeedbackFilters({ ...base, isOwner: false, params: {} });
    expect(r.where).toEqual({ agenziaId: 'c1', agenziaSedeId: { in: ['s1', 's2'] } });
  });
});

describe('resolveFeedbackFilters — filtro sede (owner)', () => {
  it('owner con sede valida: restringe a quella sede', () => {
    const r = resolveFeedbackFilters({ ...base, isOwner: true, params: { sede: 's1' } });
    expect(r.where).toEqual({ agenziaId: 'c1', agenziaSedeId: 's1' });
    expect(r.sede).toBe('s1');
    expect(r.attivi).toBe(true);
  });

  it('owner con sede NON accessibile: ignorata (fail-closed → tutte)', () => {
    const r = resolveFeedbackFilters({ ...base, isOwner: true, params: { sede: 'sX' } });
    expect(r.where).toEqual({ agenziaId: 'c1' });
    expect(r.sede).toBe('');
  });

  it('non-owner: il param sede è ignorato del tutto', () => {
    const r = resolveFeedbackFilters({ ...base, isOwner: false, params: { sede: 's1' } });
    expect(r.where).toEqual({ agenziaId: 'c1', agenziaSedeId: { in: ['s1', 's2'] } });
    expect(r.sede).toBe('');
  });
});

describe('resolveFeedbackFilters — range date (Europe/Rome)', () => {
  it('da+a estivi (CEST, +2): createdAt gte/lte in istanti UTC corretti', () => {
    const r = resolveFeedbackFilters({
      ...base,
      isOwner: true,
      params: { da: '2026-07-15', a: '2026-07-20' },
    });
    const c = r.where.createdAt as { gte: Date; lte: Date };
    expect(c.gte.toISOString()).toBe('2026-07-14T22:00:00.000Z');
    expect(c.lte.toISOString()).toBe('2026-07-20T21:59:59.999Z');
    expect(r.da).toBe('2026-07-15');
    expect(r.a).toBe('2026-07-20');
    expect(r.attivi).toBe(true);
  });

  it('data invernale (CET, +1)', () => {
    const r = resolveFeedbackFilters({ ...base, isOwner: true, params: { da: '2026-01-15' } });
    const c = r.where.createdAt as { gte: Date };
    expect(c.gte.toISOString()).toBe('2026-01-14T23:00:00.000Z');
  });

  it('solo "a": nessun gte', () => {
    const r = resolveFeedbackFilters({ ...base, isOwner: true, params: { a: '2026-07-20' } });
    const c = r.where.createdAt as { gte?: Date; lte: Date };
    expect(c.gte).toBeUndefined();
    expect(c.lte.toISOString()).toBe('2026-07-20T21:59:59.999Z');
  });

  it('date malformate o impossibili: ignorate, nessun createdAt', () => {
    const r = resolveFeedbackFilters({
      ...base,
      isOwner: true,
      params: { da: '15/07/2026', a: '2026-02-30' },
    });
    expect(r.where).toEqual({ agenziaId: 'c1' });
    expect(r.da).toBe('');
    expect(r.a).toBe('');
    expect(r.attivi).toBe(false);
  });

  it("combina sede + date per l'owner", () => {
    const r = resolveFeedbackFilters({
      ...base,
      isOwner: true,
      params: { sede: 's2', da: '2026-07-15' },
    });
    expect(r.where).toEqual({
      agenziaId: 'c1',
      agenziaSedeId: 's2',
      createdAt: { gte: new Date('2026-07-14T22:00:00.000Z') },
    });
  });
});
