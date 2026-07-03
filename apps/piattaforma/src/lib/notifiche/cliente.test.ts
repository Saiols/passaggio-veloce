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
  coAcquirenti: [],
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

  it('include indirizzo dell\'agenzia assegnata nel payload (dove recarsi)', async () => {
    findUniqueMock.mockResolvedValue({
      ...praticaPiena,
      agenziaAssegnata: {
        ragioneSociale: 'Agenzia Corsico',
        indirizzo: 'Via Roma 1',
        cap: '20094',
        citta: 'Corsico',
        provincia: 'MI',
      },
    });
    await notifyClientiAvanzamento('p1', 'PRESA_IN_CARICO');
    const payload = sendMock.mock.calls[0]![0].payload;
    expect(payload.agenziaNome).toBe('Agenzia Corsico');
    expect(payload.agenziaIndirizzo).toBe('Via Roma 1');
    expect(payload.agenziaCap).toBe('20094');
    expect(payload.agenziaCitta).toBe('Corsico');
    expect(payload.agenziaProvincia).toBe('MI');
  });

  it('preferisce l\'indirizzo della SEDE che ha accettato (multi-sede), con civico', async () => {
    findUniqueMock.mockResolvedValue({
      ...praticaPiena,
      agenziaAssegnata: {
        ragioneSociale: 'Auto Group SRL',
        indirizzo: 'Via HQ', civico: '99', cap: '00100', citta: 'Roma', provincia: 'RM',
      },
      agenziaSede: {
        nome: 'Filiale Corsico',
        indirizzo: 'Via Roma', civico: '1', cap: '20094', citta: 'Corsico', provincia: 'MI',
      },
    });
    await notifyClientiAvanzamento('p1', 'PRESA_IN_CARICO');
    const payload = sendMock.mock.calls[0]![0].payload;
    expect(payload.agenziaNome).toBe('Auto Group SRL'); // ragione sociale riconoscibile
    expect(payload.agenziaIndirizzo).toBe('Via Roma 1'); // sede + civico, NON l'HQ
    expect(payload.agenziaCap).toBe('20094');
    expect(payload.agenziaCitta).toBe('Corsico');
    expect(payload.agenziaProvincia).toBe('MI');
  });

  it('non invia se codicePratica è null (pratica senza codice)', async () => {
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
