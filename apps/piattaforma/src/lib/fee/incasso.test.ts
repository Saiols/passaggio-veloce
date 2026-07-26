import { describe, it, expect, vi, beforeEach } from 'vitest';

const { feeUpdateMany, feeFindUnique, rivaluta, createFatturaPvMock } = vi.hoisted(() => ({
  feeUpdateMany: vi.fn(),
  feeFindUnique: vi.fn(),
  rivaluta: vi.fn(),
  createFatturaPvMock: vi.fn(),
}));

vi.mock('@pv/db', () => ({
  prisma: { feeAddebito: { updateMany: feeUpdateMany, findUnique: feeFindUnique } },
}));
vi.mock('./blocco', () => ({ rivalutaBloccoAgenzia: rivaluta }));
vi.mock('@/lib/fatturazione/engine', () => ({ createFatturaPv: createFatturaPvMock }));

import { segnaFeeIncassato } from './incasso';

beforeEach(() => {
  vi.clearAllMocks();
  feeUpdateMany.mockResolvedValue({ count: 1 });
  feeFindUnique.mockResolvedValue({ agenziaId: 'ag-1' });
  rivaluta.mockResolvedValue(undefined);
  createFatturaPvMock.mockResolvedValue({ id: 'doc-1' });
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

  it("un errore in emissione non annulla l'incasso", async () => {
    createFatturaPvMock.mockRejectedValue(new Error('contatore ko'));
    await expect(segnaFeeIncassato('fee-1', 'pi_1')).resolves.toBe(true);
  });
});
