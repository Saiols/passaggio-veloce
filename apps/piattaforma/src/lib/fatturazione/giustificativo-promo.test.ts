import { describe, it, expect, vi, beforeEach } from 'vitest';

const { prismaMock, txMock, prossimoContatoreMock } = vi.hoisted(() => {
  const txMock = {
    giustificativoInterno: { findFirst: vi.fn(), create: vi.fn() },
    payout: { findUnique: vi.fn() },
    promoCodeRedemption: { findMany: vi.fn() },
  };
  return {
    txMock,
    prossimoContatoreMock: vi.fn(),
    prismaMock: {
      $transaction: vi.fn((cb: (tx: typeof txMock) => unknown) => cb(txMock)),
    },
  };
});

vi.mock('server-only', () => ({}));
vi.mock('@pv/db', () => ({ prisma: prismaMock }));
vi.mock('./numerazione', () => ({ prossimoContatore: prossimoContatoreMock }));
vi.mock('./pv-emittente', () => ({
  snapshotCompany: (c: { id: string; ragioneSociale: string }) => ({ ragioneSociale: c.ragioneSociale }),
}));
vi.mock('@/lib/format', () => ({ formatDate: () => '10/07/2026' }));

import { createGiustificativoPromo } from './giustificativo-promo';

const ANNO = new Date().getFullYear();

function payoutConPromo(over: Record<string, unknown> = {}) {
  return {
    id: 'p1',
    eseguitoAt: new Date('2026-07-10T10:00:00.000Z'),
    wallet: { sede: { company: { id: 'c1', ragioneSociale: 'Rossi Auto' } }, company: null },
    transazioni: [
      { id: 't1', tipo: 'CREDITO_PROMO', importoCent: 20_000 },
      { id: 't2', tipo: 'CREDITO_PRATICA', importoCent: 30_000 },
    ],
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  txMock.giustificativoInterno.findFirst.mockResolvedValue(null);
  txMock.payout.findUnique.mockResolvedValue(payoutConPromo());
  txMock.promoCodeRedemption.findMany.mockResolvedValue([
    { id: 'r1', amountCent: 20_000, createdAt: new Date('2026-07-01T09:00:00.000Z'), promoCode: { code: 'WELCOME' } },
  ]);
  txMock.giustificativoInterno.create.mockResolvedValue({});
  prossimoContatoreMock.mockResolvedValue(1);
});

describe('createGiustificativoPromo', () => {
  it('somma il promo del payout e crea il giustificativo con righe dal redemption', async () => {
    await createGiustificativoPromo({ payoutId: 'p1' });

    expect(prossimoContatoreMock).toHaveBeenCalledWith(txMock, 'PV', 'GIUSTIFICATIVO_INTERNO', ANNO);
    expect(txMock.giustificativoInterno.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tipo: 'COSTO_PROMO',
          importoCent: 20_000,
          numeroStr: `GI-${ANNO}-00001`,
          payoutId: 'p1',
          beneficiarioCompanyId: 'c1',
          causale: 'Bonus promozionale iscrizione — Rossi Auto — 10/07/2026',
          righe: [
            { code: 'WELCOME', dataIscrizione: '2026-07-01T09:00:00.000Z', amountCent: 20_000, redemptionId: 'r1' },
          ],
        }),
      }),
    );
  });

  it('payout senza promo → nessun giustificativo', async () => {
    txMock.payout.findUnique.mockResolvedValue(
      payoutConPromo({ transazioni: [{ id: 't2', tipo: 'CREDITO_PRATICA', importoCent: 30_000 }] }),
    );
    await createGiustificativoPromo({ payoutId: 'p1' });
    expect(txMock.giustificativoInterno.create).not.toHaveBeenCalled();
  });

  it('idempotente: se esiste già per il payout → non ricrea', async () => {
    txMock.giustificativoInterno.findFirst.mockResolvedValue({ id: 'g-esistente' });
    await createGiustificativoPromo({ payoutId: 'p1' });
    expect(txMock.payout.findUnique).not.toHaveBeenCalled();
    expect(txMock.giustificativoInterno.create).not.toHaveBeenCalled();
  });

  it('promo senza redemption collegato → crea comunque con righe vuote', async () => {
    txMock.promoCodeRedemption.findMany.mockResolvedValue([]);
    await createGiustificativoPromo({ payoutId: 'p1' });
    expect(txMock.giustificativoInterno.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ importoCent: 20_000, righe: [] }) }),
    );
  });
});
