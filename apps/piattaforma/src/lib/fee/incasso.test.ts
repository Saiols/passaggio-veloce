import { describe, it, expect, vi, beforeEach } from 'vitest';

const { feeUpdateMany, feeFindUnique, docUpdateMany, rivaluta, createFatturaPvMock, notificaMock } = vi.hoisted(() => ({
  feeUpdateMany: vi.fn(),
  feeFindUnique: vi.fn(),
  docUpdateMany: vi.fn(),
  rivaluta: vi.fn(),
  createFatturaPvMock: vi.fn(),
  notificaMock: vi.fn(),
}));

vi.mock('@pv/db', () => ({
  prisma: {
    feeAddebito: { updateMany: feeUpdateMany, findUnique: feeFindUnique },
    documentoFiscale: { updateMany: docUpdateMany },
  },
}));
vi.mock('./blocco', () => ({ rivalutaBloccoAgenzia: rivaluta }));
vi.mock('@/lib/fatturazione/engine', () => ({ createFatturaPv: createFatturaPvMock }));
vi.mock('@/lib/fatturazione/notifica-fattura', () => ({ notificaFatturaDisponibile: notificaMock }));

import { segnaFeeIncassato } from './incasso';

beforeEach(() => {
  vi.clearAllMocks();
  feeUpdateMany.mockResolvedValue({ count: 1 });
  feeFindUnique.mockResolvedValue({ agenziaId: 'ag-1', praticaId: 'pr-1' });
  docUpdateMany.mockResolvedValue({ count: 0 });
  rivaluta.mockResolvedValue(undefined);
  createFatturaPvMock.mockResolvedValue({ id: 'doc-1' });
  notificaMock.mockResolvedValue(undefined);
});

describe('segnaFeeIncassato', () => {
  it('vince il CAS: marca SUCCESS, rivaluta il blocco ed emette la fattura PAGATA', async () => {
    const out = await segnaFeeIncassato('fee-1', 'pi_1');
    expect(out).toBe(true);
    expect(rivaluta).toHaveBeenCalledWith('ag-1');
    expect(createFatturaPvMock).toHaveBeenCalledWith({
      feeAddebitoId: 'fee-1',
      statoPagamento: 'PAGATA',
    });
  });

  it('perde il CAS: nessuna seconda fattura, nessuna rivalutazione', async () => {
    feeUpdateMany.mockResolvedValue({ count: 0 });
    const out = await segnaFeeIncassato('fee-1', 'pi_1');
    expect(out).toBe(false);
    expect(createFatturaPvMock).not.toHaveBeenCalled();
    expect(rivaluta).not.toHaveBeenCalled();
  });

  it('non porta a SUCCESS un fee ANNULLATO', async () => {
    await segnaFeeIncassato('fee-1', 'pi_1');
    expect(feeUpdateMany).toHaveBeenCalledWith({
      where: { id: 'fee-1', stato: { notIn: ['SUCCESS', 'ANNULLATO'] } },
      data: {
        stato: 'SUCCESS',
        providerRef: 'pi_1',
        executedAt: expect.any(Date),
        errorMessage: null,
      },
    });
  });

  it("un errore in emissione non annulla l'incasso, ma viene loggato", async () => {
    const errore = new Error('contatore ko');
    createFatturaPvMock.mockRejectedValue(errore);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await expect(segnaFeeIncassato('fee-1', 'pi_1')).resolves.toBe(true);
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('fee-1'),
        errore,
      );
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('notifica la fattura appena creata', async () => {
    await segnaFeeIncassato('fee-1', 'pi_1');
    expect(notificaMock).toHaveBeenCalledWith('doc-1');
  });

  it('fattura già esistente: nessuna seconda N53', async () => {
    createFatturaPvMock.mockResolvedValue(null);
    await segnaFeeIncassato('fee-1', 'pi_1');
    expect(notificaMock).not.toHaveBeenCalled();
  });

  it('allinea a PAGATA una fattura rimasta IN_ATTESA (documento della valvola)', async () => {
    await segnaFeeIncassato('fee-1', 'pi_1');
    expect(docUpdateMany).toHaveBeenCalledWith({
      where: { praticaId: 'pr-1', tipo: 'FATTURA_PV', statoPagamento: 'IN_ATTESA' },
      data: { statoPagamento: 'PAGATA' },
    });
  });

  it("l'allineamento non fa partire una seconda N53", async () => {
    createFatturaPvMock.mockResolvedValue(null); // documento già esistente
    docUpdateMany.mockResolvedValue({ count: 1 }); // ed era IN_ATTESA: allineato ora
    await segnaFeeIncassato('fee-1', 'pi_1');
    expect(notificaMock).not.toHaveBeenCalled();
  });

  it("un errore nell'allineamento non annulla l'incasso", async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      docUpdateMany.mockRejectedValue(new Error('db giù'));
      await expect(segnaFeeIncassato('fee-1', 'pi_1')).resolves.toBe(true);
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('pr-1'),
        expect.any(Error),
      );
    } finally {
      errorSpy.mockRestore();
    }
  });
});
