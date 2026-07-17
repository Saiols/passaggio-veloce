import { describe, it, expect, vi, beforeEach } from 'vitest';

const { findUnique } = vi.hoisted(() => ({ findUnique: vi.fn() }));
vi.mock('@pv/db', () => ({ prisma: { company: { findUnique } } }));

import { getStatoVisura, isVisuraScadutaCompany } from './stato';

const NOW = new Date('2026-06-30T12:00:00Z'); // 180 gg dopo il 2026-01-01

beforeEach(() => vi.clearAllMocks());

describe('getStatoVisura', () => {
  it("azienda inesistente → ESENTE (non blocca su un dato che non c'e')", async () => {
    findUnique.mockResolvedValue(null);
    expect((await getStatoVisura('x', NOW)).stato).toBe('ESENTE');
  });

  it('visuraCameraleData null → ESENTE', async () => {
    findUnique.mockResolvedValue({ visuraCameraleData: null });
    expect((await getStatoVisura('x', NOW)).stato).toBe('ESENTE');
  });

  it('giorno 180 → SCADUTA', async () => {
    findUnique.mockResolvedValue({ visuraCameraleData: new Date('2026-01-01T00:00:00Z') });
    const s = await getStatoVisura('x', NOW);
    expect(s.stato).toBe('SCADUTA');
    expect(s.giorniTrascorsi).toBe(180);
    expect(s.giorniRimanenti).toBe(0);
  });

  it('giorno 175 → PREAVVISO con 5 giorni rimanenti', async () => {
    findUnique.mockResolvedValue({ visuraCameraleData: new Date('2026-01-06T00:00:00Z') });
    const s = await getStatoVisura('x', NOW);
    expect(s.stato).toBe('PREAVVISO');
    expect(s.giorniTrascorsi).toBe(175);
    expect(s.giorniRimanenti).toBe(5);
  });

  it('giorno 179 → PREAVVISO (confine alto, non ancora scaduta)', async () => {
    findUnique.mockResolvedValue({ visuraCameraleData: new Date('2026-01-02T00:00:00Z') });
    const s = await getStatoVisura('x', NOW);
    expect(s.stato).toBe('PREAVVISO');
    expect(s.giorniTrascorsi).toBe(179);
    expect(s.giorniRimanenti).toBe(1);
  });

  it('giorno 181 → SCADUTA (oltre il confine, non solo esattamente 180)', async () => {
    findUnique.mockResolvedValue({ visuraCameraleData: new Date('2025-12-31T00:00:00Z') });
    const s = await getStatoVisura('x', NOW);
    expect(s.stato).toBe('SCADUTA');
    expect(s.giorniTrascorsi).toBe(181);
    expect(s.giorniRimanenti).toBe(0);
  });

  it('visura fresca → OK', async () => {
    findUnique.mockResolvedValue({ visuraCameraleData: new Date('2026-06-01T00:00:00Z') });
    const s = await getStatoVisura('x', NOW);
    expect(s.stato).toBe('OK');
    expect(s.giorniTrascorsi).toBe(29);
    expect(s.giorniRimanenti).toBe(151);
  });

  it('espone dataEmissione così com\'è arrivata dal DB', async () => {
    const d = new Date('2026-06-01T00:00:00Z');
    findUnique.mockResolvedValue({ visuraCameraleData: d });
    const s = await getStatoVisura('x', NOW);
    expect(s.dataEmissione).toEqual(d);
  });

  it('interroga solo la company richiesta, selezionando solo visuraCameraleData', async () => {
    findUnique.mockResolvedValue({ visuraCameraleData: null });
    await getStatoVisura('company-42', NOW);
    expect(findUnique).toHaveBeenCalledWith({
      where: { id: 'company-42' },
      select: { visuraCameraleData: true },
    });
  });
});

describe('isVisuraScadutaCompany', () => {
  it('true solo su SCADUTA', async () => {
    findUnique.mockResolvedValue({ visuraCameraleData: new Date('2026-01-01T00:00:00Z') });
    expect(await isVisuraScadutaCompany('x', NOW)).toBe(true);
  });

  it('false su PREAVVISO (non ancora scaduta)', async () => {
    findUnique.mockResolvedValue({ visuraCameraleData: new Date('2026-01-06T00:00:00Z') });
    expect(await isVisuraScadutaCompany('x', NOW)).toBe(false);
  });

  it('false su OK', async () => {
    findUnique.mockResolvedValue({ visuraCameraleData: new Date('2026-06-01T00:00:00Z') });
    expect(await isVisuraScadutaCompany('x', NOW)).toBe(false);
  });

  it('null → false (esente, mai bloccata)', async () => {
    findUnique.mockResolvedValue({ visuraCameraleData: null });
    expect(await isVisuraScadutaCompany('x', NOW)).toBe(false);
  });

  it('azienda inesistente → false (esente, mai bloccata)', async () => {
    findUnique.mockResolvedValue(null);
    expect(await isVisuraScadutaCompany('x', NOW)).toBe(false);
  });
});
