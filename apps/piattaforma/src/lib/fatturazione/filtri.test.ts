import { describe, it, expect } from 'vitest';
import { parseFatturaFiltri, fatturaWhereFiltri, fatturaFiltriToQuery } from './filtri';

describe('parseFatturaFiltri', () => {
  it('normalizza tipo/date valide, scarta quelle invalide', () => {
    const f = parseFatturaFiltri({
      q: '  PV-1 ',
      tipo: 'FATTURA_PV',
      dataDa: '2026-06-01',
      dataA: 'non-una-data',
      sede: ' s1 ',
    });
    expect(f).toEqual({
      q: 'PV-1',
      tipo: 'FATTURA_PV',
      dataDa: '2026-06-01',
      dataA: null,
      sedeId: 's1',
    });
  });

  it('tipo non valido → null', () => {
    expect(parseFatturaFiltri({ tipo: 'XXX' }).tipo).toBeNull();
  });
});

describe('fatturaWhereFiltri', () => {
  it('nessun filtro → {}', () => {
    expect(fatturaWhereFiltri(parseFatturaFiltri({}))).toEqual({});
  });

  it('q numerica → OR su codicePratica + numeroProgressivo', () => {
    expect(fatturaWhereFiltri(parseFatturaFiltri({ q: '42' }))).toEqual({
      AND: [
        {
          OR: [
            { pratica: { codicePratica: { contains: '42', mode: 'insensitive' } } },
            { numeroProgressivo: 42 },
          ],
        },
      ],
    });
  });

  it('intervallo date → emessoAt gte/lte (UTC)', () => {
    expect(fatturaWhereFiltri(parseFatturaFiltri({ dataDa: '2026-06-01', dataA: '2026-06-30' }))).toEqual({
      AND: [
        {
          emessoAt: {
            gte: new Date('2026-06-01T00:00:00.000Z'),
            lte: new Date('2026-06-30T23:59:59.999Z'),
          },
        },
      ],
    });
  });

  it('sede → OR su pratica.agenzia/broker + payout.wallet', () => {
    expect(fatturaWhereFiltri(parseFatturaFiltri({ sede: 's1' }))).toEqual({
      AND: [
        {
          OR: [
            { pratica: { agenziaSedeId: 's1' } },
            { pratica: { brokerSedeId: 's1' } },
            { payout: { wallet: { sedeId: 's1' } } },
          ],
        },
      ],
    });
  });
});

describe('fatturaFiltriToQuery', () => {
  it('serializza solo i filtri attivi', () => {
    const qs = fatturaFiltriToQuery(parseFatturaFiltri({ q: 'PV', tipo: 'DOC_BROKER', dataDa: '2026-06-01' }));
    expect(qs).toBe('q=PV&tipo=DOC_BROKER&dataDa=2026-06-01');
  });
});
