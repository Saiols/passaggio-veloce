import { describe, it, expect, vi, beforeEach } from 'vitest';

const { feeFindMany, docFindMany, createFatturaPvMock, notificaMock } = vi.hoisted(() => ({
  feeFindMany: vi.fn(),
  docFindMany: vi.fn(),
  createFatturaPvMock: vi.fn(),
  notificaMock: vi.fn(),
}));

vi.mock('@pv/db', () => ({
  prisma: { feeAddebito: { findMany: feeFindMany }, documentoFiscale: { findMany: docFindMany } },
}));
vi.mock('@/lib/fatturazione/engine', () => ({ createFatturaPv: createFatturaPvMock }));
vi.mock('@/lib/fatturazione/notifica-fattura', () => ({ notificaFatturaDisponibile: notificaMock }));

import { riconciliaFattureIncassate } from './riconcilia-fatture';

beforeEach(() => {
  vi.clearAllMocks();
  feeFindMany.mockResolvedValue([{ id: 'fee-1' }]);
  docFindMany.mockResolvedValue([]);
  createFatturaPvMock.mockResolvedValue({ id: 'doc-1' });
  notificaMock.mockResolvedValue(true);
});

describe('riconciliaFattureIncassate', () => {
  it('fee SUCCESS senza fattura: la emette PAGATA e la notifica', async () => {
    const out = await riconciliaFattureIncassate();
    expect(createFatturaPvMock).toHaveBeenCalledWith({
      feeAddebitoId: 'fee-1',
      statoPagamento: 'PAGATA',
    });
    expect(notificaMock).toHaveBeenCalledWith('doc-1');
    expect(out).toEqual({ emesse: 1, notificate: 1 });
  });

  it('nessun fee scoperto e nessun documento da notificare: no-op', async () => {
    feeFindMany.mockResolvedValue([]);
    const out = await riconciliaFattureIncassate();
    expect(createFatturaPvMock).not.toHaveBeenCalled();
    expect(notificaMock).not.toHaveBeenCalled();
    expect(out).toEqual({ emesse: 0, notificate: 0 });
  });

  it('documento già emesso ma email mai partita: rimanda solo la N53', async () => {
    feeFindMany.mockResolvedValue([]);
    docFindMany.mockResolvedValue([{ id: 'doc-9' }]);
    const out = await riconciliaFattureIncassate();
    expect(createFatturaPvMock).not.toHaveBeenCalled();
    expect(notificaMock).toHaveBeenCalledWith('doc-9');
    expect(out).toEqual({ emesse: 0, notificate: 1 });
  });

  it('scarta a monte i fee che hanno già la loro FATTURA_PV: i 30 slot restano ai casi da lavorare', async () => {
    await riconciliaFattureIncassate();
    expect(feeFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          stato: 'SUCCESS',
          pratica: { documentiFiscali: { none: { tipo: 'FATTURA_PV' } } },
        }),
        take: 30,
      }),
    );
  });

  it('lascia al percorso d’incasso una finestra di grazia sugli incassi freschissimi', async () => {
    await riconciliaFattureIncassate();
    const where = feeFindMany.mock.calls[0][0].where as {
      executedAt: { gte: Date; lt: Date };
    };
    expect(where.executedAt.gte).toBeInstanceOf(Date);
    expect(where.executedAt.lt).toBeInstanceOf(Date);
    const graziaMs = Date.now() - where.executedAt.lt.getTime();
    // ~5 minuti (tolleranza per il tempo di esecuzione del test).
    expect(graziaMs).toBeGreaterThanOrEqual(5 * 60 * 1000 - 1000);
    expect(graziaMs).toBeLessThan(5 * 60 * 1000 + 5000);
    // La finestra resta di 7 giorni.
    const finestraMs = where.executedAt.lt.getTime() - where.executedAt.gte.getTime();
    expect(finestraMs).toBeGreaterThan(6 * 24 * 60 * 60 * 1000);
  });

  it('cerca i documenti da notificare solo fra le fatture PAGATA: in mock (IN_ATTESA) è inerte', async () => {
    await riconciliaFattureIncassate();
    expect(docFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tipo: 'FATTURA_PV',
          statoPagamento: 'PAGATA',
          inviatoEmailAt: null,
        }),
        take: 30,
      }),
    );
  });

  it("l'emissione fallisce: nessuna eccezione, contatori a zero, errore loggato", async () => {
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

  it('la N53 esce senza inviare (destinatario assente): non viene contata come notificata', async () => {
    feeFindMany.mockResolvedValue([]);
    docFindMany.mockResolvedValue([{ id: 'doc-9' }]);
    notificaMock.mockResolvedValue(false);
    const out = await riconciliaFattureIncassate();
    expect(notificaMock).toHaveBeenCalledWith('doc-9');
    expect(out).toEqual({ emesse: 0, notificate: 0 });
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
    feeFindMany.mockResolvedValue([{ id: 'fee-1' }, { id: 'fee-2' }]);
    const errore = new Error('connessione db persa a metà giro');
    // Primo fee: emesso e notificato. Secondo: l'emissione esplode con un
    // errore non gestibile dal `.catch` per-item (qui simulato sulla lettura
    // dei documenti che segue).
    createFatturaPvMock.mockResolvedValueOnce({ id: 'doc-1' }).mockResolvedValueOnce({ id: 'doc-2' });
    docFindMany.mockRejectedValue(errore);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const out = await riconciliaFattureIncassate();
      expect(out).toEqual({ emesse: 2, notificate: 2 });
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('[riconciliaFatture]'), errore);
    } finally {
      errorSpy.mockRestore();
    }
  });
});
