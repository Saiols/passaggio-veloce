import { describe, it, expect, vi, beforeEach } from 'vitest';

const { tx, prismaMock } = vi.hoisted(() => {
  const tx = {
    pratica: { findUnique: vi.fn(), update: vi.fn() },
    sede: { findMany: vi.fn() },
    valutazione: { groupBy: vi.fn() },
    praticaAssegnazione: { findMany: vi.fn(), create: vi.fn() },
    orariApertura: { findMany: vi.fn() },
    chiusuraStraordinaria: { findMany: vi.fn() },
  };
  const prismaMock = {
    $transaction: vi.fn((cb: (t: typeof tx) => unknown) => cb(tx)),
    praticaAssegnazione: { findMany: vi.fn() },
  };
  return { tx, prismaMock };
});

vi.mock('@pv/db', () => ({ prisma: prismaMock, Prisma: {} }));
vi.mock('@/lib/notifiche', () => ({
  sendNotification: vi.fn(() => Promise.resolve()),
  sendNotifications: vi.fn(() => Promise.resolve()),
  getAdminEmails: vi.fn(() => Promise.resolve([])),
}));
vi.mock('@/lib/eventi/emit', () => ({
  emitEventiPratica: vi.fn(() => Promise.resolve()),
  emitEventoPratica: vi.fn(() => Promise.resolve()),
}));

import { avviaRound1ForPratica } from './tick';

beforeEach(() => {
  vi.clearAllMocks();
  tx.pratica.findUnique
    .mockResolvedValueOnce({ id: 'p1', provincia: 'VE', assegnazioni: [] })
    .mockResolvedValueOnce({ stato: 'IN_ATTESA_ROUND_1' });
  // Tre sedi: m1 ne ha due (s1, s2), m2 una (s3). Atteso: una per madre.
  tx.sede.findMany.mockResolvedValue([
    { id: 's1', createdAt: new Date('2026-01-01'), nome: 'A1', provincia: 'VE', companyId: 'm1' },
    { id: 's2', createdAt: new Date('2026-01-02'), nome: 'A2', provincia: 'VE', companyId: 'm1' },
    { id: 's3', createdAt: new Date('2026-01-03'), nome: 'B1', provincia: 'VE', companyId: 'm2' },
  ]);
  tx.valutazione.groupBy.mockResolvedValue([]);
  tx.praticaAssegnazione.findMany.mockResolvedValue([]);
  tx.orariApertura.findMany.mockResolvedValue([]);
  tx.chiusuraStraordinaria.findMany.mockResolvedValue([]);
  let n = 0;
  tx.praticaAssegnazione.create.mockImplementation(() => Promise.resolve({ id: `a${++n}` }));
  tx.pratica.update.mockResolvedValue({});
  prismaMock.praticaAssegnazione.findMany.mockResolvedValue([]);
});

describe('avviaRound1ForPratica (multi-sede)', () => {
  it('seleziona SEDI agenzia attive per provincia (non Company)', async () => {
    await avviaRound1ForPratica('p1');
    expect(tx.sede.findMany).toHaveBeenCalledTimes(1);
    const where = tx.sede.findMany.mock.calls[0][0].where;
    expect(where.type).toBe('AGENZIA');
    expect(where.suspendedAt).toBeNull();
    expect(where.deletedAt).toBeNull();
  });

  it('crea una assegnazione per madre, con agenziaId=madre e sedeId=sede', async () => {
    await avviaRound1ForPratica('p1');
    const pairs = tx.praticaAssegnazione.create.mock.calls.map((c) => ({
      agenziaId: c[0].data.agenziaId,
      sedeId: c[0].data.sedeId,
    }));
    expect(pairs).toHaveLength(2); // s2 (stessa madre m1 di s1) dedupata
    expect(pairs).toContainEqual({ agenziaId: 'm1', sedeId: 's1' });
    expect(pairs).toContainEqual({ agenziaId: 'm2', sedeId: 's3' });
    const madri = pairs.map((p) => p.agenziaId);
    expect(new Set(madri).size).toBe(madri.length); // mai due della stessa madre
  });
});
