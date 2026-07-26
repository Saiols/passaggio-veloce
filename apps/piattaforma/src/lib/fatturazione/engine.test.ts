import { describe, it, expect, vi, beforeEach } from 'vitest';

const { txMock, prismaMock, prossimoContatoreMock } = vi.hoisted(() => {
  const txMock = {
    feeAddebito: { findUnique: vi.fn() },
    documentoFiscale: { findFirst: vi.fn(), create: vi.fn() },
    company: { findUnique: vi.fn() },
  };
  return {
    txMock,
    prismaMock: { $transaction: vi.fn(async (cb: (t: unknown) => unknown) => cb(txMock)) },
    prossimoContatoreMock: vi.fn(),
  };
});

vi.mock('@pv/db', () => ({ prisma: prismaMock }));
vi.mock('./numerazione', () => ({ prossimoContatore: prossimoContatoreMock }));
vi.mock('./pv-emittente', () => ({
  pvEmittente: () => ({ ragioneSociale: 'PV' }),
  snapshotCompany: (c: { ragioneSociale: string }) => ({ ragioneSociale: c.ragioneSociale }),
}));

import { createFatturaPv } from './engine';

const FEE = { id: 'fee-1', praticaId: 'pr-1', agenziaId: 'ag-1', importoCent: 7500 };

beforeEach(() => {
  vi.clearAllMocks();
  txMock.feeAddebito.findUnique.mockResolvedValue(FEE);
  txMock.documentoFiscale.findFirst.mockResolvedValue(null);
  txMock.company.findUnique.mockResolvedValue({ id: 'ag-1', ragioneSociale: 'Agenzia Uno' });
  txMock.documentoFiscale.create.mockResolvedValue({ id: 'doc-1' });
  prossimoContatoreMock.mockResolvedValue(3);
});

describe('createFatturaPv', () => {
  it("usa l'importo del fee, non quello previsto sulla pratica", async () => {
    txMock.feeAddebito.findUnique.mockResolvedValue({ ...FEE, importoCent: 3000 });
    await createFatturaPv({ feeAddebitoId: 'fee-1', statoPagamento: 'PAGATA' });
    expect(txMock.documentoFiscale.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ importoLordoCent: 3000 }),
      }),
    );
  });

  it('propaga lo statoPagamento richiesto dal chiamante e lega il fee al documento', async () => {
    await createFatturaPv({ feeAddebitoId: 'fee-1', statoPagamento: 'PAGATA' });
    expect(txMock.documentoFiscale.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ statoPagamento: 'PAGATA', feeAddebitoId: 'fee-1' }),
      }),
    );
  });

  it('restituisce il documento creato', async () => {
    const out = await createFatturaPv({ feeAddebitoId: 'fee-1', statoPagamento: 'IN_ATTESA' });
    expect(out).toEqual({ id: 'doc-1' });
  });

  it('restituisce null e non crea nulla se la fattura della pratica esiste già', async () => {
    txMock.documentoFiscale.findFirst.mockResolvedValue({ id: 'doc-esistente' });
    const out = await createFatturaPv({ feeAddebitoId: 'fee-1', statoPagamento: 'PAGATA' });
    expect(out).toBeNull();
    expect(txMock.documentoFiscale.create).not.toHaveBeenCalled();
  });

  it('restituisce null su fee inesistente o importo non positivo', async () => {
    txMock.feeAddebito.findUnique.mockResolvedValue(null);
    expect(await createFatturaPv({ feeAddebitoId: 'x', statoPagamento: 'PAGATA' })).toBeNull();

    txMock.feeAddebito.findUnique.mockResolvedValue({ ...FEE, importoCent: 0 });
    expect(await createFatturaPv({ feeAddebitoId: 'fee-1', statoPagamento: 'PAGATA' })).toBeNull();
    expect(txMock.documentoFiscale.create).not.toHaveBeenCalled();
  });
});
