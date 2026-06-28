import { describe, it, expect, vi, beforeEach } from 'vitest';

const { findUniqueMock, sendMock } = vi.hoisted(() => ({
  findUniqueMock: vi.fn(),
  sendMock: vi.fn(),
}));

vi.mock('@pv/db', () => ({ prisma: { pratica: { findUnique: findUniqueMock } } }));
vi.mock('./send', () => ({ sendNotification: sendMock }));

import { notifyClientiAvanzamento } from './cliente';

beforeEach(() => {
  vi.clearAllMocks();
  sendMock.mockResolvedValue(undefined);
});

const praticaPiena = {
  codicePratica: 'PV-2026-001',
  acquirenteEmail: 'buyer@x.it',
  acquirenteNome: 'Mario',
  acquirenteCognome: 'Rossi',
  acquirenteIsPersonaGiuridica: false,
  acquirenteRagioneSociale: null,
  venditori: [
    { email: 'seller@x.it', nome: 'Anna', cognome: 'Bianchi', isPersonaGiuridica: false, ragioneSociale: null },
    { email: 'BUYER@x.it', nome: 'Dup', cognome: 'X', isPersonaGiuridica: false, ragioneSociale: null },
  ],
  veicoli: [{ targa: 'AB123CD' }],
};

describe('notifyClientiAvanzamento', () => {
  it('invia una N40 per destinatario deduplicato con payload corretto', async () => {
    findUniqueMock.mockResolvedValue(praticaPiena);
    await notifyClientiAvanzamento('p1', 'COMPLETATA');

    expect(sendMock).toHaveBeenCalledTimes(2); // buyer + seller, duplicato saltato
    const tos = sendMock.mock.calls.map((c) => c[0].target.email);
    expect(tos).toEqual(['buyer@x.it', 'seller@x.it']);
    const first = sendMock.mock.calls[0]![0];
    expect(first.tipo).toBe('N40_CLIENTE_AVANZAMENTO');
    expect(first.payload.stato).toBe('COMPLETATA');
    expect(first.payload.codicePratica).toBe('PV-2026-001');
    expect(first.payload.veicoloDescrizione).toBe('AB123CD');
    expect(first.payload.ruolo).toBe('ACQUIRENTE');
  });

  it('non invia se la pratica e in bozza (codicePratica null)', async () => {
    findUniqueMock.mockResolvedValue({ ...praticaPiena, codicePratica: null });
    await notifyClientiAvanzamento('p1', 'AVVIATA');
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('non invia se nessun destinatario ha email', async () => {
    findUniqueMock.mockResolvedValue({
      ...praticaPiena, acquirenteEmail: null, venditori: [],
    });
    await notifyClientiAvanzamento('p1', 'AVVIATA');
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('non propaga errori del provider (best-effort)', async () => {
    findUniqueMock.mockResolvedValue(praticaPiena);
    sendMock.mockRejectedValue(new Error('provider down'));
    await expect(notifyClientiAvanzamento('p1', 'AVVIATA')).resolves.toBeUndefined();
  });
});
