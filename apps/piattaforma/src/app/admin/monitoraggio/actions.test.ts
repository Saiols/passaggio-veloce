import { describe, it, expect, vi, beforeEach } from 'vitest';

const { authMock, txMock, transactionMock, avviaRoundMock, postCommitMock,
  sendMock, notifyClientiMock, destSedeMock, destBrokerMock, emitEventoMock, logMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  txMock: {
    pratica: { findUnique: vi.fn(), update: vi.fn() },
    praticaAssegnazione: { updateMany: vi.fn(), findMany: vi.fn() },
  },
  transactionMock: vi.fn(),
  avviaRoundMock: vi.fn(),
  postCommitMock: vi.fn(),
  sendMock: vi.fn(),
  notifyClientiMock: vi.fn(),
  destSedeMock: vi.fn(),
  destBrokerMock: vi.fn(),
  emitEventoMock: vi.fn(),
  logMock: vi.fn(),
}));

vi.mock('@/auth', () => ({ auth: authMock }));
vi.mock('@pv/db', () => ({ prisma: { $transaction: transactionMock } }));
vi.mock('@/lib/distribuzione/tick', () => ({ avviaRound: avviaRoundMock, processPostCommitJobs: postCommitMock }));
vi.mock('@/lib/pratiche/stato-log', () => ({ logCambioStato: logMock, STATO_EVENTO: { RECIRCULATE: 'RECIRCULATE' } }));
vi.mock('@/lib/notifiche', () => ({ sendNotification: sendMock, notifyClientiAvanzamento: notifyClientiMock }));
vi.mock('@/lib/notifiche/pratica', () => ({ destinatariSedeAgenzia: destSedeMock, destinatariBroker: destBrokerMock }));
vi.mock('@/lib/eventi/emit', () => ({ emitEventoPratica: emitEventoMock }));
vi.mock('@/lib/eventi/pratica-eventi', () => ({ eventoPraticaRevocata: vi.fn(() => ({})) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect: vi.fn() }));

import { revocaERimettiInCircoloAction } from './actions';

beforeEach(() => {
  vi.clearAllMocks();
  transactionMock.mockImplementation(async (cb: (tx: typeof txMock) => unknown) => cb(txMock));
  txMock.praticaAssegnazione.findMany.mockResolvedValue([{ sedeId: 'sRev', ciclo: 1, esito: 'REVOCATA_ADMIN' }]);
  avviaRoundMock.mockResolvedValue({ count: 2, newAssegnazioniIds: ['n1', 'n2'], escalated: false });
  postCommitMock.mockResolvedValue(undefined);
  destSedeMock.mockResolvedValue([{ email: 'ag@x.it', userId: 'u9', nome: 'Auto MI' }]);
  destBrokerMock.mockResolvedValue([{ email: 'br@x.it', userId: 'u1', nome: 'Rossi' }]);
  sendMock.mockResolvedValue(undefined);
  notifyClientiMock.mockResolvedValue(undefined);
  emitEventoMock.mockResolvedValue(undefined);
});

const praticaAccettata = {
  id: 'p1', stato: 'ACCETTATA', provincia: 'MI', processataAt: null, distribuzioneCiclo: 1,
  agenziaAssegnataId: 'aRev', agenziaSedeId: 'sRev', brokerId: 'bMadre', codicePratica: 'PV-2026-1',
  veicoli: [{ targa: 'AB123CD' }],
};

describe('revocaERimettiInCircoloAction', () => {
  it('rifiuta i non super-admin', async () => {
    authMock.mockResolvedValue({ user: { id: 'x', role: 'ASSISTENTE' } });
    const res = await revocaERimettiInCircoloAction('p1', 'x');
    expect(res.ok).toBe(false);
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it('rifiuta se la pratica non è accettata/non lavorata', async () => {
    authMock.mockResolvedValue({ user: { id: 'adm', role: 'ADMIN_PIATTAFORMA' } });
    txMock.pratica.findUnique.mockResolvedValue({ ...praticaAccettata, stato: 'PROCESSATA' });
    const res = await revocaERimettiInCircoloAction('p1');
    expect(res.ok).toBe(false);
  });

  it('happy path: revoca, riavvia e invia le notifiche', async () => {
    authMock.mockResolvedValue({ user: { id: 'adm', role: 'ADMIN_PIATTAFORMA' } });
    txMock.pratica.findUnique.mockResolvedValue(praticaAccettata);

    const res = await revocaERimettiInCircoloAction('p1', 'ferma da giorni');

    expect(res.ok).toBe(true);
    // assegnazione vincente → REVOCATA_ADMIN
    expect(txMock.praticaAssegnazione.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { praticaId: 'p1', ciclo: 1, esito: 'ACCETTATA' },
        data: expect.objectContaining({ esito: 'REVOCATA_ADMIN' }),
      }),
    );
    // pratica sganciata + ciclo incrementato
    expect(txMock.pratica.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'p1' },
        data: expect.objectContaining({ agenziaAssegnataId: null, distribuzioneCiclo: 2, accettataAt: null }),
      }),
    );
    expect(avviaRoundMock).toHaveBeenCalled();
    expect(logMock).toHaveBeenCalled();
    // N50 all'agenzia + N51 al broker + clienti + evento
    const tipiInviati = sendMock.mock.calls.map((c) => c[0].tipo);
    expect(tipiInviati).toContain('N50_AGENZIA_PRATICA_REVOCATA');
    expect(tipiInviati).toContain('N51_BROKER_PRATICA_RIMESSA_IN_CIRCOLO');
    expect(notifyClientiMock).toHaveBeenCalledWith('p1', 'RIMESSA_IN_CIRCOLO');
    expect(emitEventoMock).toHaveBeenCalled();
    expect(postCommitMock).toHaveBeenCalledWith({ newAssegnazioniIds: ['n1', 'n2'], escalationPraticaId: null });
  });
});
