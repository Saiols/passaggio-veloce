import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { prismaMock, cfgMock } = vi.hoisted(() => ({
  prismaMock: {
    pratica: { findUnique: vi.fn() },
    sede: { findMany: vi.fn() },
  },
  cfgMock: vi.fn(),
}));

vi.mock('@pv/db', () => ({ prisma: prismaMock }));
vi.mock('./config', () => ({ getDistribuzioneConfig: cfgMock }));

import { getCoperturaPratica } from './copertura';

const LAT0 = 45;
const LNG0 = 12;
/** Latitudine spostata di `km` esatti rispetto a LAT0. */
function kmLat(km: number): number {
  return LAT0 + (km / 6371) * (180 / Math.PI);
}

const OGGI = new Date('2026-07-26T10:00:00Z');
const VISURA_OK = new Date('2026-06-01T00:00:00Z');
const VISURA_SCADUTA = new Date('2024-12-13T00:00:00Z');

function sede(over: Record<string, unknown> = {}) {
  return {
    id: 's1',
    nome: 'Sede 1',
    citta: 'Assago',
    lat: kmLat(4),
    lng: LNG0,
    companyId: 'c1',
    suspendedAt: null,
    company: {
      ragioneSociale: 'Agenzia 1',
      deletedAt: null,
      suspendedAt: null,
      bloccoPagamentoAt: null,
      visuraCameraleData: VISURA_OK,
    },
    ...over,
  };
}

// Il modulo chiama `new Date()` per valutare la visura: l'orologio va fissato,
// e poi RIPRISTINATO — dei fake timer lasciati attivi avvelenerebbero i file
// di test eseguiti dopo questo nello stesso worker.
afterEach(() => vi.useRealTimers());

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(OGGI);
  cfgMock.mockResolvedValue({ raggioMaxM: 10000 });
  prismaMock.pratica.findUnique.mockResolvedValue({
    id: 'p1',
    lat: LAT0,
    lng: LNG0,
    raggioCorrenteM: 2000,
    distribuzioneCiclo: 1,
    assegnazioni: [],
  });
});

describe('getCoperturaPratica', () => {
  it('pratica inesistente → null', async () => {
    prismaMock.pratica.findUnique.mockResolvedValue(null);
    await expect(getCoperturaPratica('nope')).resolves.toBeNull();
  });

  it('sede idonea oltre il raggio corrente → in attesa, con la distanza', async () => {
    prismaMock.sede.findMany.mockResolvedValue([sede()]);
    const out = await getCoperturaPratica('p1');
    expect(out!.sedi).toHaveLength(1);
    expect(out!.sedi[0]!.stato).toBe('in-attesa');
    expect(out!.sedi[0]!.distanzaM).toBe(4000);
    expect(out!.sedi[0]!.motivo).toBeNull();
  });

  it('sede già contattata → contattata, con round ed esito', async () => {
    prismaMock.pratica.findUnique.mockResolvedValue({
      id: 'p1',
      lat: LAT0,
      lng: LNG0,
      raggioCorrenteM: 5000,
      distribuzioneCiclo: 1,
      assegnazioni: [{ sedeId: 's1', ciclo: 1, round: 2, esito: 'PENDING' }],
    });
    prismaMock.sede.findMany.mockResolvedValue([sede()]);
    const out = await getCoperturaPratica('p1');
    expect(out!.sedi[0]!.stato).toBe('contattata');
    expect(out!.sedi[0]!.round).toBe(2);
    expect(out!.sedi[0]!.esito).toBe('PENDING');
  });

  it('visura oltre 180 giorni → esclusa con motivo VISURA_SCADUTA', async () => {
    prismaMock.sede.findMany.mockResolvedValue([
      sede({ company: { ...sede().company, visuraCameraleData: VISURA_SCADUTA } }),
    ]);
    const out = await getCoperturaPratica('p1');
    expect(out!.sedi[0]!.stato).toBe('esclusa');
    expect(out!.sedi[0]!.motivo).toBe('VISURA_SCADUTA');
  });

  it('visura null → NON è un motivo di esclusione (i null sono esenti)', async () => {
    prismaMock.sede.findMany.mockResolvedValue([
      sede({ company: { ...sede().company, visuraCameraleData: null } }),
    ]);
    const out = await getCoperturaPratica('p1');
    expect(out!.sedi[0]!.stato).toBe('in-attesa');
  });

  it('sede sospesa, azienda sospesa e blocco pagamento hanno motivi distinti', async () => {
    prismaMock.sede.findMany.mockResolvedValue([
      sede({ id: 'a', suspendedAt: OGGI }),
      sede({ id: 'b', company: { ...sede().company, suspendedAt: OGGI } }),
      sede({ id: 'c', company: { ...sede().company, bloccoPagamentoAt: OGGI } }),
    ]);
    const out = await getCoperturaPratica('p1');
    const motivi = Object.fromEntries(out!.sedi.map((s) => [s.sedeId, s.motivo]));
    expect(motivi).toEqual({ a: 'SEDE_SOSPESA', b: 'AZIENDA_SOSPESA', c: 'BLOCCO_PAGAMENTO' });
  });

  it('revoca admin → esclusione permanente, anche se la sede è idonea', async () => {
    prismaMock.pratica.findUnique.mockResolvedValue({
      id: 'p1',
      lat: LAT0,
      lng: LNG0,
      raggioCorrenteM: 5000,
      distribuzioneCiclo: 2,
      assegnazioni: [{ sedeId: 's1', ciclo: 1, round: 1, esito: 'REVOCATA_ADMIN' }],
    });
    prismaMock.sede.findMany.mockResolvedValue([sede()]);
    const out = await getCoperturaPratica('p1');
    expect(out!.sedi[0]!.stato).toBe('esclusa');
    expect(out!.sedi[0]!.motivo).toBe('REVOCATA_ADMIN');
  });

  it('sedi oltre il raggio massimo non compaiono', async () => {
    prismaMock.sede.findMany.mockResolvedValue([sede({ lat: kmLat(40) })]);
    const out = await getCoperturaPratica('p1');
    expect(out!.sedi).toHaveLength(0);
  });

  it('sedi senza coordinate finiscono in una lista separata, senza distanza inventata', async () => {
    prismaMock.sede.findMany.mockResolvedValue([sede({ id: 'x', lat: null, lng: null })]);
    const out = await getCoperturaPratica('p1');
    expect(out!.sedi).toHaveLength(0);
    expect(out!.senzaCoordinate).toEqual([{ sedeId: 'x', nome: 'Sede 1', citta: 'Assago' }]);
  });

  it('pratica senza coordinate → nessuna distanza calcolabile, solo la lista senza coord', async () => {
    prismaMock.pratica.findUnique.mockResolvedValue({
      id: 'p1',
      lat: null,
      lng: null,
      raggioCorrenteM: null,
      distribuzioneCiclo: 1,
      assegnazioni: [],
    });
    prismaMock.sede.findMany.mockResolvedValue([sede()]);
    const out = await getCoperturaPratica('p1');
    expect(out!.sedi).toHaveLength(0);
    expect(out!.senzaCoordinate).toHaveLength(0);
    expect(out!.origineMancante).toBe(true);
  });

  it('ordina per distanza crescente', async () => {
    prismaMock.sede.findMany.mockResolvedValue([
      sede({ id: 'lontana', lat: kmLat(6) }),
      sede({ id: 'vicina', lat: kmLat(1) }),
    ]);
    const out = await getCoperturaPratica('p1');
    expect(out!.sedi.map((s) => s.sedeId)).toEqual(['vicina', 'lontana']);
  });
});
