import { describe, it, expect } from 'vitest';
import {
  parseFatturaFiltri,
  parseFatturaFiltriFromUrl,
  fatturaWhereFiltri,
  fatturaFiltriToQuery,
} from './filtri';

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
      emissione: null,
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

describe('filtro emissione', () => {
  it('parse legge ?emissione=', () => {
    expect(parseFatturaFiltri({ emissione: 'DA_EMETTERE' }).emissione).toBe('DA_EMETTERE');
    expect(parseFatturaFiltri({ emissione: 'PIPPO' }).emissione).toBeNull();
    expect(parseFatturaFiltri({}).emissione).toBeNull();
  });

  it('il where esclude i documenti fuori campo SdI dai "da emettere"', () => {
    const w = fatturaWhereFiltri(parseFatturaFiltri({ emissione: 'DA_EMETTERE' }));
    expect(w).toEqual({
      AND: [{ fatturaPaTipo: { not: null }, trasmessoSdiAt: null }],
    });
  });

  // Il vincolo del modulo: filtri e scope si compongono con AND. Se il filtro
  // emissione finisse fuori dall'array AND, un domani uno spread lo perderebbe.
  it('si combina con gli altri filtri dentro lo stesso AND', () => {
    const w = fatturaWhereFiltri(parseFatturaFiltri({ emissione: 'EMESSA', tipo: 'FATTURA_PV' }));
    expect(w.AND).toHaveLength(2);
  });

  it('round-trip: query → parse → query', () => {
    const f = parseFatturaFiltri({ emissione: 'DA_EMETTERE', q: 'PV-2026' });
    expect(fatturaFiltriToQuery(f)).toContain('emissione=DA_EMETTERE');
  });
});

describe('parseFatturaFiltriFromUrl (C-1)', () => {
  // Entry point unico per i consumer che partono da un URL (export CSV, ZIP):
  // legge TUTTE le chiavi note da sé, invece di farsele elencare a mano dal
  // chiamante — è esattamente l'elenco a mano che aveva "dimenticato" `emissione`.
  it('legge tutte le chiavi, compresa emissione, da un URL reale', () => {
    const url = new URL(
      'http://x/api/admin/fatturazione/export?q=PV-1&tipo=FATTURA_PV&dataDa=2026-06-01&sede=s1&emissione=DA_EMETTERE',
    );
    expect(parseFatturaFiltriFromUrl(url)).toEqual({
      q: 'PV-1',
      tipo: 'FATTURA_PV',
      dataDa: '2026-06-01',
      dataA: null,
      sedeId: 's1',
      emissione: 'DA_EMETTERE',
    });
  });

  it('senza query string → nessun filtro attivo', () => {
    expect(parseFatturaFiltriFromUrl(new URL('http://x/api/admin/fatturazione/export'))).toEqual(
      parseFatturaFiltri({}),
    );
  });

  it('chiavi sconosciute nell’URL sono ignorate (validate da parseFatturaFiltri)', () => {
    const url = new URL('http://x/api/admin/fatturazione/export?pippo=1&emissione=EMESSA');
    expect(parseFatturaFiltriFromUrl(url).emissione).toBe('EMESSA');
  });
});
