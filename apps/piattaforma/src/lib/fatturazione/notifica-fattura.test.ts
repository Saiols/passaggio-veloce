import { describe, it, expect, vi, beforeEach } from 'vitest';

const { docFindUnique, docUpdateMany, sendMock, attachmentMock } = vi.hoisted(() => ({
  docFindUnique: vi.fn(),
  docUpdateMany: vi.fn(),
  sendMock: vi.fn(),
  attachmentMock: vi.fn(),
}));

vi.mock('@pv/db', () => ({
  prisma: { documentoFiscale: { findUnique: docFindUnique, updateMany: docUpdateMany } },
}));
vi.mock('@/lib/notifiche', () => ({ sendNotification: sendMock }));
vi.mock('./documento-pdf', () => ({ fatturaPvAttachment: attachmentMock }));

import { notificaFatturaDisponibile } from './notifica-fattura';

const DOC = {
  id: 'doc-1',
  praticaId: 'pr-1',
  numeroDocumentoStr: 'PV-2026-00003',
  importoLordoCent: 7500,
  inviatoEmailAt: null,
  pratica: { codicePratica: 'PV-0001' },
  destinatarioCompany: {
    id: 'ag-1',
    ragioneSociale: 'Agenzia Uno',
    email: 'azienda@agenzia.it',
    users: [{ id: 'u-1', email: 'admin@agenzia.it' }],
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  docFindUnique.mockResolvedValue(DOC);
  docUpdateMany.mockResolvedValue({ count: 1 });
  sendMock.mockResolvedValue(undefined);
  attachmentMock.mockResolvedValue({ filename: 'f.pdf', content: 'x', contentType: 'application/pdf' });
});

describe('notificaFatturaDisponibile', () => {
  it("manda la N53 all'admin azienda con il PDF allegato e prenota inviatoEmailAt PRIMA dell'invio", async () => {
    const inviata = await notificaFatturaDisponibile('doc-1');
    expect(inviata).toBe(true);
    expect(sendMock).toHaveBeenCalledWith(
      expect.objectContaining({
        tipo: 'N53_AGENZIA_FATTURA_DISPONIBILE',
        target: expect.objectContaining({ email: 'admin@agenzia.it', companyId: 'ag-1' }),
        payload: expect.objectContaining({
          numeroDocumento: 'PV-2026-00003',
          importoCent: 7500,
          fatturaAllegata: true,
        }),
      }),
      expect.objectContaining({ attachments: [expect.objectContaining({ filename: 'f.pdf' })] }),
    );
    expect(docUpdateMany).toHaveBeenCalledWith({
      where: { id: 'doc-1', inviatoEmailAt: null },
      data: { inviatoEmailAt: expect.any(Date) },
    });
    // Ordine: la prenotazione deve avvenire PRIMA dell'invio (sendNotification
    // è fire-and-log e non dice nulla sull'esito reale a chi la chiama).
    const ordinePrenotazione = docUpdateMany.mock.invocationCallOrder[0];
    const ordineInvio = sendMock.mock.invocationCallOrder[0];
    expect(ordinePrenotazione).toBeLessThan(ordineInvio);
  });

  it('non rimanda una fattura già inviata', async () => {
    docFindUnique.mockResolvedValue({ ...DOC, inviatoEmailAt: new Date() });
    const inviata = await notificaFatturaDisponibile('doc-1');
    expect(inviata).toBe(false);
    expect(sendMock).not.toHaveBeenCalled();
    expect(docUpdateMany).not.toHaveBeenCalled();
  });

  it('prenotazione persa (count 0): nessun invio — evita la doppia email in caso di corsa', async () => {
    docUpdateMany.mockResolvedValue({ count: 0 });
    const inviata = await notificaFatturaDisponibile('doc-1');
    expect(inviata).toBe(false);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('documento senza destinatario: nessun invio e ritorna false (il chiamante non deve contarlo)', async () => {
    docFindUnique.mockResolvedValue({ ...DOC, destinatarioCompany: null });
    const inviata = await notificaFatturaDisponibile('doc-1');
    expect(inviata).toBe(false);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('nessuna email raggiungibile (né admin né azienda): ritorna false', async () => {
    docFindUnique.mockResolvedValue({
      ...DOC,
      destinatarioCompany: { ...DOC.destinatarioCompany, email: null, users: [] },
    });
    const inviata = await notificaFatturaDisponibile('doc-1');
    expect(inviata).toBe(false);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("ripiega sull'email azienda se non c'è un admin attivo", async () => {
    docFindUnique.mockResolvedValue({
      ...DOC,
      destinatarioCompany: { ...DOC.destinatarioCompany, users: [] },
    });
    await notificaFatturaDisponibile('doc-1');
    expect(sendMock).toHaveBeenCalledWith(
      expect.objectContaining({ target: expect.objectContaining({ email: 'azienda@agenzia.it' }) }),
      expect.anything(),
    );
  });

  it('allegato non generabile: logga e invia comunque senza allegato, con fatturaAllegata false', async () => {
    const errore = new Error('pdf ko');
    attachmentMock.mockRejectedValue(errore);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await notificaFatturaDisponibile('doc-1');
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('doc-1'), errore);
      expect(sendMock).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({ fatturaAllegata: false }),
        }),
        expect.anything(),
      );
      expect(sendMock.mock.calls[0][1].attachments).toBeUndefined();
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("l'invio esplode: la prenotazione viene RILASCIATA e l'eccezione propaga", async () => {
    // Caso reale: enum NotificaTipo non ancora migrata su Neon → la create di
    // NotificaInviata (dentro sendNotification, PRIMA del suo try/catch) lancia.
    // Se `inviatoEmailAt` restasse scritto, la riconciliazione oraria
    // considererebbe inviata per sempre una fattura mai partita.
    const errore = new Error('invalid input value for enum NotificaTipo');
    sendMock.mockRejectedValue(errore);
    await expect(notificaFatturaDisponibile('doc-1')).rejects.toBe(errore);
    expect(docUpdateMany).toHaveBeenCalledTimes(2);
    expect(docUpdateMany).toHaveBeenLastCalledWith({
      where: { id: 'doc-1' },
      data: { inviatoEmailAt: null },
    });
  });

  it("il rilascio della prenotazione fallisce: logga con l'id documento e propaga l'errore originale", async () => {
    const errore = new Error('resend giù');
    const erroreRilascio = new Error('db giù');
    sendMock.mockRejectedValue(errore);
    docUpdateMany.mockResolvedValueOnce({ count: 1 }).mockRejectedValueOnce(erroreRilascio);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await expect(notificaFatturaDisponibile('doc-1')).rejects.toBe(errore);
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('doc-1'), erroreRilascio);
    } finally {
      errorSpy.mockRestore();
    }
  });
});
