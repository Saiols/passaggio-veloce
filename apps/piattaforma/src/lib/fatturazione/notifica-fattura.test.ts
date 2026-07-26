import { describe, it, expect, vi, beforeEach } from 'vitest';

const { docFindUnique, docUpdate, sendMock, attachmentMock } = vi.hoisted(() => ({
  docFindUnique: vi.fn(),
  docUpdate: vi.fn(),
  sendMock: vi.fn(),
  attachmentMock: vi.fn(),
}));

vi.mock('@pv/db', () => ({
  prisma: { documentoFiscale: { findUnique: docFindUnique, update: docUpdate } },
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
  docUpdate.mockResolvedValue({});
  sendMock.mockResolvedValue(undefined);
  attachmentMock.mockResolvedValue({ filename: 'f.pdf', content: 'x', contentType: 'application/pdf' });
});

describe('notificaFatturaDisponibile', () => {
  it("manda la N53 all'admin azienda con il PDF allegato e segna inviatoEmailAt", async () => {
    await notificaFatturaDisponibile('doc-1');
    expect(sendMock).toHaveBeenCalledWith(
      expect.objectContaining({
        tipo: 'N53_AGENZIA_FATTURA_DISPONIBILE',
        target: expect.objectContaining({ email: 'admin@agenzia.it', companyId: 'ag-1' }),
        payload: expect.objectContaining({ numeroDocumento: 'PV-2026-00003', importoCent: 7500 }),
      }),
      expect.objectContaining({ attachments: [expect.objectContaining({ filename: 'f.pdf' })] }),
    );
    expect(docUpdate).toHaveBeenCalledWith({
      where: { id: 'doc-1' },
      data: { inviatoEmailAt: expect.any(Date) },
    });
  });

  it('non rimanda una fattura già inviata', async () => {
    docFindUnique.mockResolvedValue({ ...DOC, inviatoEmailAt: new Date() });
    await notificaFatturaDisponibile('doc-1');
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
});
