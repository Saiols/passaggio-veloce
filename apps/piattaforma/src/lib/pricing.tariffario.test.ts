import { describe, it, expect, vi, beforeEach } from 'vitest';

const findFirst = vi.fn();
vi.mock('@pv/db', () => ({ prisma: { tariffaPiattaforma: { findFirst: (...a: unknown[]) => findFirst(...a) } } }));

import { getTariffarioCorrente } from './tariffario';
import { DEFAULT_TARIFFARIO } from './pricing';

describe('getTariffarioCorrente', () => {
  beforeEach(() => findFirst.mockReset());

  it('fallback a DEFAULT quando non c\'è riga attiva', async () => {
    findFirst.mockResolvedValue(null);
    expect(await getTariffarioCorrente()).toEqual(DEFAULT_TARIFFARIO);
  });
});
