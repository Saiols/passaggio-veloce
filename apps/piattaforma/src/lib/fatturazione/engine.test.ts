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

  it("numera sull'anno civile ITALIANO, non su quello del runtime", async () => {
    // 23:30 UTC del 31 dicembre = 00:30 del 1° gennaio a Roma. Ora che
    // l'emissione è guidata da cron e webhook quell'ora è raggiungibile da un
    // processo automatico: una fattura italiana datata 1° gennaio non deve
    // prendere numero e anno del registro appena chiuso.
    //
    // TZ forzato a UTC — che è il fuso del runtime Vercel in produzione — e NON
    // lasciato a quello della macchina: su un portatile italiano
    // `new Date().getFullYear()` restituisce già 2027 e il bug sarebbe
    // invisibile, cioè il test resterebbe verde anche senza la correzione.
    const tzOriginale = process.env.TZ;
    vi.useFakeTimers();
    try {
      process.env.TZ = 'UTC';
      vi.setSystemTime(new Date('2026-12-31T23:30:00Z'));
      expect(new Date().getFullYear()).toBe(2026); // premessa del test
      await createFatturaPv({ feeAddebitoId: 'fee-1', statoPagamento: 'PAGATA' });
      expect(prossimoContatoreMock).toHaveBeenCalledWith(
        expect.anything(),
        'PV',
        'FATTURA_PV',
        2027,
      );
      expect(txMock.documentoFiscale.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ anno: 2027 }) }),
      );
    } finally {
      vi.useRealTimers();
      if (tzOriginale === undefined) delete process.env.TZ;
      else process.env.TZ = tzOriginale;
    }
  });

  it('restituisce null su fee inesistente o importo non positivo', async () => {
    txMock.feeAddebito.findUnique.mockResolvedValue(null);
    expect(await createFatturaPv({ feeAddebitoId: 'x', statoPagamento: 'PAGATA' })).toBeNull();

    txMock.feeAddebito.findUnique.mockResolvedValue({ ...FEE, importoCent: 0 });
    expect(await createFatturaPv({ feeAddebitoId: 'fee-1', statoPagamento: 'PAGATA' })).toBeNull();
    expect(txMock.documentoFiscale.create).not.toHaveBeenCalled();
  });

  it('conflitto sul vincolo (praticaId, tipo): ritorna null invece di propagare', async () => {
    prismaMock.$transaction.mockRejectedValueOnce(
      Object.assign(new Error('Unique constraint failed'), {
        code: 'P2002',
        meta: { target: ['praticaId', 'tipo'] },
      }),
    );
    const out = await createFatturaPv({ feeAddebitoId: 'fee-1', statoPagamento: 'PAGATA' });
    expect(out).toBeNull();
  });

  it('un P2002 su un altro vincolo NON viene inghiottito', async () => {
    prismaMock.$transaction.mockRejectedValueOnce(
      Object.assign(new Error('Unique constraint failed'), {
        code: 'P2002',
        meta: { target: ['numeroDocumentoStr'] },
      }),
    );
    await expect(
      createFatturaPv({ feeAddebitoId: 'fee-1', statoPagamento: 'PAGATA' }),
    ).rejects.toThrow('Unique constraint failed');
  });

  it('un errore qualsiasi NON viene inghiottito', async () => {
    prismaMock.$transaction.mockRejectedValueOnce(new Error('connessione persa'));
    await expect(
      createFatturaPv({ feeAddebitoId: 'fee-1', statoPagamento: 'PAGATA' }),
    ).rejects.toThrow('connessione persa');
  });
});
