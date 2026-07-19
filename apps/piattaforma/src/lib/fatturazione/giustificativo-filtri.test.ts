import { describe, it, expect } from 'vitest';
import {
  parseGiustificativoFiltri,
  parseGiustificativoFiltriFromUrl,
  giustificativoWhere,
} from './giustificativo-filtri';

describe('parseGiustificativoFiltri', () => {
  it('normalizza le date valide, scarta le invalide', () => {
    expect(parseGiustificativoFiltri({ dataDa: ' 2026-06-01 ', dataA: 'nope' })).toEqual({
      dataDa: '2026-06-01',
      dataA: null,
    });
  });
});

describe('giustificativoWhere', () => {
  it('nessun filtro → {}', () => {
    expect(giustificativoWhere(parseGiustificativoFiltri({}))).toEqual({});
  });

  it('intervallo → emessoAt gte/lte (UTC)', () => {
    expect(giustificativoWhere(parseGiustificativoFiltri({ dataDa: '2026-06-01', dataA: '2026-06-30' }))).toEqual({
      emessoAt: {
        gte: new Date('2026-06-01T00:00:00.000Z'),
        lte: new Date('2026-06-30T23:59:59.999Z'),
      },
    });
  });
});

describe('parseGiustificativoFiltriFromUrl', () => {
  it('legge le chiavi dall’URL', () => {
    const url = new URL('http://x/api?dataDa=2026-06-01&dataA=2026-06-30&pippo=1');
    expect(parseGiustificativoFiltriFromUrl(url)).toEqual({ dataDa: '2026-06-01', dataA: '2026-06-30' });
  });
});
