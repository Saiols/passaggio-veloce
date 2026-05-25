import { describe, it, expect } from 'vitest';
import { GUIDES, getGuide, otherGuides } from './guides';

describe('GUIDES', () => {
  it('contiene esattamente 3 entry', () => {
    expect(GUIDES).toHaveLength(3);
  });

  it('tutti gli slug sono univoci', () => {
    const slugs = GUIDES.map((g) => g.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it('ogni url è coerente con il proprio slug', () => {
    for (const g of GUIDES) {
      expect(g.url).toBe(`/guide/${g.slug}`);
    }
  });

  it('include le 3 pillar attese', () => {
    const slugs = GUIDES.map((g) => g.slug);
    expect(slugs).toContain('come-fare-passaggio-di-proprieta');
    expect(slugs).toContain('costi-passaggio-proprieta');
    expect(slugs).toContain('documenti-necessari');
  });

  it('readingTimeMin è un intero positivo', () => {
    for (const g of GUIDES) {
      expect(Number.isInteger(g.readingTimeMin)).toBe(true);
      expect(g.readingTimeMin).toBeGreaterThan(0);
    }
  });

  it('jsonLdType è HowTo solo per la guida procedurale', () => {
    const howTo = GUIDES.filter((g) => g.jsonLdType === 'HowTo');
    expect(howTo).toHaveLength(1);
    expect(howTo[0].slug).toBe('come-fare-passaggio-di-proprieta');
  });
});

describe('getGuide', () => {
  it('ritorna la guida se slug esiste', () => {
    const g = getGuide('costi-passaggio-proprieta');
    expect(g).toBeDefined();
    expect(g?.slug).toBe('costi-passaggio-proprieta');
  });

  it('ritorna undefined se slug non esiste', () => {
    expect(getGuide('inesistente')).toBeUndefined();
  });
});

describe('otherGuides', () => {
  it('ritorna le 2 guide diverse dallo slug corrente', () => {
    const others = otherGuides('come-fare-passaggio-di-proprieta');
    expect(others).toHaveLength(2);
    expect(others.map((g) => g.slug)).not.toContain('come-fare-passaggio-di-proprieta');
  });

  it('se slug non valido ritorna tutte le 3', () => {
    expect(otherGuides('inesistente')).toHaveLength(3);
  });
});
