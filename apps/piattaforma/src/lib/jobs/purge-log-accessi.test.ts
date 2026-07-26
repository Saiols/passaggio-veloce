import { describe, it, expect, vi, beforeEach } from 'vitest';

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: { logAccesso: { deleteMany: vi.fn() } },
}));

vi.mock('server-only', () => ({}));
vi.mock('@pv/db', () => ({ prisma: prismaMock }));

import { purgeLogAccessi } from './purge-log-accessi';
import { LOG_RETENTION_GIORNI } from '@/lib/audit/log-accessi';

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.logAccesso.deleteMany.mockResolvedValue({ count: 0 });
});

/**
 * Senza questo job la privacy policy direbbe una cosa falsa: dichiara 24 mesi,
 * e senza cancellazione il log resterebbe per sempre. Un registro accessi è a
 * sua volta un archivio di dati personali: conservarlo oltre il necessario è
 * la violazione, non la tutela.
 */
describe('purgeLogAccessi', () => {
  it('cancella esattamente ciò che è più vecchio della retention dichiarata', async () => {
    const now = new Date('2026-07-26T12:00:00.000Z');

    await purgeLogAccessi(now);

    const where = prismaMock.logAccesso.deleteMany.mock.calls[0][0].where;
    const atteso = new Date(now.getTime() - LOG_RETENTION_GIORNI * 24 * 3600 * 1000);
    expect(where.createdAt.lt).toEqual(atteso);
  });

  it('la retention è di 24 mesi, come dice la policy', () => {
    // Se qualcuno cambia la costante senza toccare il testo di /privacy, i due
    // divergono in silenzio: qui si rompe il test.
    expect(LOG_RETENTION_GIORNI).toBe(730);
  });

  it('restituisce quante righe ha eliminato', async () => {
    prismaMock.logAccesso.deleteMany.mockResolvedValue({ count: 42 });

    await expect(purgeLogAccessi(new Date())).resolves.toEqual({ eliminati: 42 });
  });

  it('cancella per SOLA data: nessun altro filtro può salvare una riga scaduta', async () => {
    await purgeLogAccessi(new Date());

    const where = prismaMock.logAccesso.deleteMany.mock.calls[0][0].where;
    expect(Object.keys(where)).toEqual(['createdAt']);
  });
});
