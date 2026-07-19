import { describe, it, expect, vi, beforeEach } from 'vitest';

const findUnique = vi.fn();
const upsert = vi.fn();
const update = vi.fn();
const deleteMany = vi.fn();

vi.mock('@pv/db', () => ({
  prisma: {
    rateBucket: {
      findUnique: (...a: unknown[]) => findUnique(...a),
      upsert: (...a: unknown[]) => upsert(...a),
      update: (...a: unknown[]) => update(...a),
      deleteMany: (...a: unknown[]) => deleteMany(...a),
    },
  },
}));

import { rateLimit, resetRateLimit } from './durable';

beforeEach(() => {
  findUnique.mockReset();
  upsert.mockReset();
  update.mockReset();
  deleteMany.mockReset();
});

describe('rateLimit (durevole, DB-backed)', () => {
  it('consente sotto il limite (bucket esistente, non scaduto)', async () => {
    findUnique.mockResolvedValue({
      key: 'k',
      count: 3,
      expiresAt: new Date(Date.now() + 60_000),
    });
    update.mockResolvedValue({ count: 4 });

    const r = await rateLimit('k', 10, 60);

    expect(r.allowed).toBe(true);
    expect(update).toHaveBeenCalledWith({
      where: { key: 'k' },
      data: { count: { increment: 1 } },
    });
    expect(upsert).not.toHaveBeenCalled();
  });

  it('blocca oltre il limite', async () => {
    findUnique.mockResolvedValue({
      key: 'k',
      count: 10,
      expiresAt: new Date(Date.now() + 60_000),
    });
    update.mockResolvedValue({ count: 11 });

    const r = await rateLimit('k', 10, 60);

    expect(r.allowed).toBe(false);
  });

  it('resetta la finestra quando il bucket è scaduto (count riparte da 1)', async () => {
    findUnique.mockResolvedValue({
      key: 'k',
      count: 999,
      expiresAt: new Date(Date.now() - 1000), // scaduto
    });
    upsert.mockResolvedValue({ count: 1 });

    const r = await rateLimit('k', 10, 60);

    expect(r.allowed).toBe(true);
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { key: 'k' },
        create: expect.objectContaining({ key: 'k', count: 1 }),
        update: expect.objectContaining({ count: 1 }),
      }),
    );
    expect(update).not.toHaveBeenCalled();
  });

  it('resetta quando il bucket non esiste ancora', async () => {
    findUnique.mockResolvedValue(null);
    upsert.mockResolvedValue({ count: 1 });

    const r = await rateLimit('k', 10, 60);

    expect(r.allowed).toBe(true);
    expect(upsert).toHaveBeenCalledTimes(1);
  });

  it('FAIL-OPEN: un errore DB (findUnique) consente comunque la richiesta', async () => {
    findUnique.mockRejectedValue(new Error('connessione DB persa'));

    const r = await rateLimit('k', 10, 60);

    expect(r).toEqual({ allowed: true });
  });

  it('FAIL-OPEN: un errore DB (update) consente comunque la richiesta', async () => {
    findUnique.mockResolvedValue({
      key: 'k',
      count: 3,
      expiresAt: new Date(Date.now() + 60_000),
    });
    update.mockRejectedValue(new Error('timeout'));

    const r = await rateLimit('k', 10, 60);

    expect(r).toEqual({ allowed: true });
  });
});

describe('resetRateLimit', () => {
  it('cancella il bucket (best-effort)', async () => {
    deleteMany.mockResolvedValue({ count: 1 });
    await resetRateLimit('k');
    expect(deleteMany).toHaveBeenCalledWith({ where: { key: 'k' } });
  });

  it('ignora silenziosamente un errore (non deve mai far fallire il chiamante)', async () => {
    deleteMany.mockRejectedValue(new Error('boom'));
    await expect(resetRateLimit('k')).resolves.toBeUndefined();
  });
});
