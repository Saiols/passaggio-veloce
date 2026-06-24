import { describe, it, expect } from 'vitest';
import { dedupeByMadre } from './dedupe';

describe('dedupeByMadre', () => {
  it('tiene una sola sede per azienda madre (la prima = migliore, lista già ordinata)', () => {
    const eligible = [
      { id: 's1', companyId: 'm1' },
      { id: 's2', companyId: 'm1' }, // stessa madre → scartata
      { id: 's3', companyId: 'm2' },
    ];
    expect(dedupeByMadre(eligible)).toEqual([
      { id: 's1', companyId: 'm1' },
      { id: 's3', companyId: 'm2' },
    ]);
  });

  it('preserva l’ordine di ranking', () => {
    const eligible = [
      { id: 's3', companyId: 'm2' },
      { id: 's1', companyId: 'm1' },
      { id: 's2', companyId: 'm1' },
    ];
    expect(dedupeByMadre(eligible).map((x) => x.id)).toEqual(['s3', 's1']);
  });

  it('lista vuota → vuota', () => {
    expect(dedupeByMadre([])).toEqual([]);
  });
});
