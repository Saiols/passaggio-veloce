import { describe, it, expect, vi, beforeEach } from 'vitest';

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    payout: { findFirst: vi.fn() },
    transazioneWallet: { groupBy: vi.fn() },
  },
}));

vi.mock('server-only', () => ({}));
vi.mock('@pv/db', () => ({ prisma: prismaMock }));

import { getWalletBreakdown } from './breakdown';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('getWalletBreakdown', () => {
  it('nessun payout precedente → since = epoch, voci ordinate per importo desc', async () => {
    prismaMock.payout.findFirst.mockResolvedValue(null);
    prismaMock.transazioneWallet.groupBy.mockResolvedValue([
      { tipo: 'CREDITO_PROMO', _sum: { importoCent: 10_000 } },
      { tipo: 'CREDITO_PRATICA', _sum: { importoCent: 60_000 } },
    ]);

    const r = await getWalletBreakdown('w1', 70_000);

    expect(r.saldoCent).toBe(70_000);
    // ordinate per importo decrescente, nessun residuo (somma === saldo)
    expect(r.voci).toEqual([
      { tipo: 'CREDITO_PRATICA', importoCent: 60_000 },
      { tipo: 'CREDITO_PROMO', importoCent: 10_000 },
    ]);
    // finestra: dall'inizio dei tempi, escluse le righe di payout
    expect(prismaMock.transazioneWallet.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        by: ['tipo'],
        where: expect.objectContaining({
          walletId: 'w1',
          createdAt: { gt: new Date(0) },
          tipo: { notIn: ['PAYOUT_AUTOMATICO', 'PAYOUT_MANUALE'] },
        }),
      }),
    );
  });

  it('filtra le voci a zero/null e mostra le penali negative', async () => {
    prismaMock.payout.findFirst.mockResolvedValue(null);
    prismaMock.transazioneWallet.groupBy.mockResolvedValue([
      { tipo: 'CREDITO_PRATICA', _sum: { importoCent: 60_000 } },
      { tipo: 'CREDITO_PROMO', _sum: { importoCent: 5_000 } },
      { tipo: 'PENALE_BROKER', _sum: { importoCent: -2_500 } },
      { tipo: 'STORNO', _sum: { importoCent: 0 } }, // scartata
      { tipo: 'RETTIFICA_ADMIN', _sum: { importoCent: null } }, // scartata (null→0)
    ]);

    const r = await getWalletBreakdown('w1', 62_500);

    expect(r.voci).toEqual([
      { tipo: 'CREDITO_PRATICA', importoCent: 60_000 },
      { tipo: 'CREDITO_PROMO', importoCent: 5_000 },
      { tipo: 'PENALE_BROKER', importoCent: -2_500 },
    ]);
  });

  it('riconciliazione: se le voci non quadrano col saldo, aggiunge un residuo ALTRO', async () => {
    const eseguitoAt = new Date('2026-06-01T10:00:00.000Z');
    prismaMock.payout.findFirst.mockResolvedValue({ eseguitoAt });
    prismaMock.transazioneWallet.groupBy.mockResolvedValue([
      { tipo: 'CREDITO_PRATICA', _sum: { importoCent: 60_000 } },
    ]);

    // saldo reale 70.000 ma le voci sommano 60.000 → residuo 10.000
    const r = await getWalletBreakdown('w1', 70_000);

    expect(r.voci).toEqual([
      { tipo: 'CREDITO_PRATICA', importoCent: 60_000 },
      { tipo: 'ALTRO', importoCent: 10_000 },
    ]);
    // la somma delle voci quadra sempre con l'importo erogato
    expect(r.voci.reduce((s, v) => s + v.importoCent, 0)).toBe(70_000);
    // finestra: dall'ultimo payout eseguito
    expect(prismaMock.transazioneWallet.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ createdAt: { gt: eseguitoAt } }),
      }),
    );
  });
});
