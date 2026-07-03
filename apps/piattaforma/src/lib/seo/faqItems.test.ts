import { describe, it, expect } from 'vitest';
import { buildFaqItems } from './faqItems';

describe('buildFaqItems', () => {
  it('interpola il compenso broker corrente nella FAQ "Come vengo pagato"', () => {
    const faq = buildFaqItems(30);
    const pagato = faq.find((f) => f.q.includes('Come vengo pagato'));
    expect(pagato?.a).toContain('30€');
  });
});
