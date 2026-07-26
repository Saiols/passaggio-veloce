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

  it("l'emissione fallisce: nessuna eccezione, contatori a zero, errore loggato", async () => {
    docFindFirst.mockResolvedValue(null);
    const errore = new Error('contatore ko');
    createFatturaPvMock.mockRejectedValue(errore);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const out = await riconciliaFattureIncassate();
      expect(out).toEqual({ emesse: 0, notificate: 0 });
      expect(notificaMock).not.toHaveBeenCalled();
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('fee-1'), errore);
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('la fattura si emette ma la N53 fallisce: notificate non conta un invio fallito', async () => {
    docFindFirst.mockResolvedValue(null);
    const errore = new Error('resend giù');
    notificaMock.mockRejectedValue(errore);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const out = await riconciliaFattureIncassate();
      expect(out).toEqual({ emesse: 1, notificate: 0 });
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('doc-1'), errore);
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('fattura presente ma email mai partita, la N53 fallisce: notificate resta a zero', async () => {
    docFindFirst.mockResolvedValue({ id: 'doc-1', inviatoEmailAt: null });
    const errore = new Error('resend giù');
    notificaMock.mockRejectedValue(errore);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const out = await riconciliaFattureIncassate();
      expect(out).toEqual({ emesse: 0, notificate: 0 });
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('doc-1'), errore);
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('un guasto nella lettura dei fee non propaga: nessuna eccezione, contatori a zero', async () => {
    const errore = new Error('connessione db persa');
    feeFindMany.mockRejectedValue(errore);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const out = await riconciliaFattureIncassate();
      expect(out).toEqual({ emesse: 0, notificate: 0 });
      expect(createFatturaPvMock).not.toHaveBeenCalled();
      expect(notificaMock).not.toHaveBeenCalled();
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('[riconciliaFatture]'), errore);
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('la passata si interrompe a metà: i contatori riflettono il lavoro già fatto, non zero', async () => {
    feeFindMany.mockResolvedValue([
      { id: 'fee-1', praticaId: 'pr-1' },
      { id: 'fee-2', praticaId: 'pr-2' },
    ]);
    const errore = new Error('connessione db persa a metà giro');
    // Primo fee: nessuna fattura, si emette e si notifica con successo.
    // Secondo fee: la lettura del documento esplode e interrompe il ciclo.
    docFindFirst.mockResolvedValueOnce(null).mockRejectedValueOnce(errore);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const out = await riconciliaFattureIncassate();
      expect(out).toEqual({ emesse: 1, notificate: 1 });
      expect(createFatturaPvMock).toHaveBeenCalledTimes(1);
      expect(createFatturaPvMock).toHaveBeenCalledWith({
        feeAddebitoId: 'fee-1',
        statoPagamento: 'PAGATA',
      });
      expect(notificaMock).toHaveBeenCalledTimes(1);
      expect(notificaMock).toHaveBeenCalledWith('doc-1');
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('[riconciliaFatture]'), errore);
    } finally {
      errorSpy.mockRestore();
    }
  });
});
