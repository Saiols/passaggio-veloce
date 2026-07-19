import { describe, it, expect, vi, beforeEach } from 'vitest';

const { authMock, txMock, transactionMock, avviaRoundMock, postCommitMock,
  sendMock, notifyClientiMock, destSedeMock, destBrokerMock, emitEventoMock, logMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  txMock: {
    pratica: { findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
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
vi.mock('@/lib/distribuzione/tick', () => ({
  avviaRound: avviaRoundMock,
  processPostCommitJobs: postCommitMock,
  statoNomePerRound: (round: 1 | 2 | 3) =>
    round === 1 ? 'IN_ATTESA_ROUND_1' : round === 2 ? 'IN_ATTESA_ROUND_2' : 'IN_ATTESA_ROUND_3',
}));
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
  avviaRoundMock.mockResolvedValue({ count: 2, newAssegnazioniIds: ['n1', 'n2'], escalated: false, round: 1 });
  txMock.pratica.updateMany.mockResolvedValue({ count: 1 });
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
    // pratica sganciata + ciclo incrementato (compare-and-set)
    expect(txMock.pratica.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'p1', stato: 'ACCETTATA', processataAt: null, distribuzioneCiclo: 1 }),
        data: expect.objectContaining({ agenziaAssegnataId: null, distribuzioneCiclo: 2, accettataAt: null }),
      }),
    );
    expect(avviaRoundMock).toHaveBeenCalled();
    expect(logMock).toHaveBeenCalled();
    // il log riflette il round realmente assegnato da avviaRound (qui: round 1, nessuna cascade)
    expect(logMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        statoA: 'IN_ATTESA_ROUND_1',
        meta: expect.objectContaining({ round: 1, escalated: false }),
      }),
    );
    // N50 all'agenzia + N51 al broker + clienti + evento
    const tipiInviati = sendMock.mock.calls.map((c) => c[0].tipo);
    expect(tipiInviati).toContain('N50_AGENZIA_PRATICA_REVOCATA');
    expect(tipiInviati).toContain('N51_BROKER_PRATICA_RIMESSA_IN_CIRCOLO');
    expect(notifyClientiMock).toHaveBeenCalledWith('p1', 'RIMESSA_IN_CIRCOLO');
    expect(emitEventoMock).toHaveBeenCalled();
    expect(postCommitMock).toHaveBeenCalledWith({ newAssegnazioniIds: ['n1', 'n2'], escalationPraticaId: null });
  });

  it('cascade: avviaRound salta al round 2 (anello 2km vuoto) → il log riporta round 2, non 1 hardcoded', async () => {
    authMock.mockResolvedValue({ user: { id: 'adm', role: 'ADMIN_PIATTAFORMA' } });
    txMock.pratica.findUnique.mockResolvedValue(praticaAccettata);
    avviaRoundMock.mockResolvedValue({ count: 3, newAssegnazioniIds: ['n3'], escalated: false, round: 2 });

    const res = await revocaERimettiInCircoloAction('p1', 'ferma da giorni');

    expect(res.ok).toBe(true);
    expect(logMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        statoA: 'IN_ATTESA_ROUND_2',
        meta: expect.objectContaining({ round: 2, escalated: false }),
      }),
    );
  });

  it('escalation: avviaRound esaurisce i 3 anelli → il log riporta IN_ESCALATION e round 3', async () => {
    authMock.mockResolvedValue({ user: { id: 'adm', role: 'ADMIN_PIATTAFORMA' } });
    txMock.pratica.findUnique.mockResolvedValue(praticaAccettata);
    avviaRoundMock.mockResolvedValue({ count: 0, newAssegnazioniIds: [], escalated: true, round: 3 });

    const res = await revocaERimettiInCircoloAction('p1', 'nessuna sede in zona');

    expect(res.ok).toBe(true);
    expect(logMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        statoA: 'IN_ESCALATION',
        meta: expect.objectContaining({ round: 3, escalated: true }),
      }),
    );
  });
});
