import { describe, it, expect, vi, beforeEach } from 'vitest';

const { feeFindMany, docFindFirst, createFatturaPvMock, notificaMock } = vi.hoisted(() => ({
  feeFindMany: vi.fn(),
  docFindFirst: vi.fn(),
  createFatturaPvMock: vi.fn(),
  notificaMock: vi.fn(),
}));

vi.mock('@pv/db', () => ({
  prisma: { feeAddebito: { findMany: feeFindMany }, documentoFiscale: { findFirst: docFindFirst } },
}));
vi.mock('@/lib/fatturazione/engine', () => ({ createFatturaPv: createFatturaPvMock }));
vi.mock('@/lib/fatturazione/notifica-fattura', () => ({ notificaFatturaDisponibile: notificaMock }));

import { riconciliaFattureIncassate } from './riconcilia-fatture';

beforeEach(() => {
  vi.clearAllMocks();
  feeFindMany.mockResolvedValue([{ id: 'fee-1', praticaId: 'pr-1' }]);
  createFatturaPvMock.mockResolvedValue({ id: 'doc-1' });
  notificaMock.mockResolvedValue(undefined);
});

describe('riconciliaFattureIncassate', () => {
  it('fee SUCCESS senza fattura: la emette PAGATA e la notifica', async () => {
    docFindFirst.mockResolvedValue(null);
    const out = await riconciliaFattureIncassate();
    expect(createFatturaPvMock).toHaveBeenCalledWith({
      feeAddebitoId: 'fee-1',
      statoPagamento: 'PAGATA',
    });
    expect(notificaMock).toHaveBeenCalledWith('doc-1');
    expect(out).toEqual({ emesse: 1, notificate: 1 });
  });

  it('fattura già presente e già inviata: no-op', async () => {
    docFindFirst.mockResolvedValue({ id: 'doc-1', inviatoEmailAt: new Date() });
    const out = await riconciliaFattureIncassate();
    expect(createFatturaPvMock).not.toHaveBeenCalled();
    expect(notificaMock).not.toHaveBeenCalled();
    expect(out).toEqual({ emesse: 0, notificate: 0 });
  });

  it('fattura presente ma email mai partita: rimanda solo la N53', async () => {
    docFindFirst.mockResolvedValue({ id: 'doc-1', inviatoEmailAt: null });
    const out = await riconciliaFattureIncassate();
    expect(createFatturaPvMock).not.toHaveBeenCalled();
    expect(notificaMock).toHaveBeenCalledWith('doc-1');
    expect(out).toEqual({ emesse: 0, notificate: 1 });
  });

  it('guarda solo i fee SUCCESS di una finestra recente', async () => {
    docFindFirst.mockResolvedValue(null);
    await riconciliaFattureIncassate();
    expect(feeFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { stato: 'SUCCESS', executedAt: { gte: expect.any(Date) } },
      }),
    );
  });
});
