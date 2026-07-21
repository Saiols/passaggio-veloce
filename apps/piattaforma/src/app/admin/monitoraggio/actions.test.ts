import { describe, it, expect, vi, beforeEach } from 'vitest';

const { authMock, txMock, transactionMock, ring1Mock,
  sendMock, notifyClientiMock, destSedeMock, destBrokerMock, emitEventoMock, logMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  txMock: {
    pratica: { findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    praticaAssegnazione: { updateMany: vi.fn(), findMany: vi.fn() },
  },
  transactionMock: vi.fn(),
  ring1Mock: vi.fn(),
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
  // v2: la revoca riporta la pratica in IN_DISTRIBUZIONE (dentro la tx) e fa
  // ripartire il primo anello via avviaRound1ForPratica (tx propria + N6).
  avviaRound1ForPratica: ring1Mock,
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
  ring1Mock.mockResolvedValue({ assegnazioni: 2, stato: 'IN_DISTRIBUZIONE', newAssegnazioniIds: ['n1', 'n2'] });
  txMock.pratica.updateMany.mockResolvedValue({ count: 1 });
  destSedeMock.mockResolvedValue([{ email: 'ag@x.it', userId: 'u9', nome: 'Auto MI' }]);
  destBrokerMock.mockResolvedValue([{ email: 'br@x.it', userId: 'u1', nome: 'Rossi' }]);
  sendMock.mockResolvedValue(undefined);
  notifyClientiMock.mockResolvedValue(undefined);
  emitEventoMock.mockResolvedValue(undefined);
});

const praticaAccettata = {
  id: 'p1', stato: 'ACCETTATA', provincia: 'MI', lat: 45, lng: 9, processataAt: null, distribuzioneCiclo: 1,
  agenziaAssegnataId: 'aRev', agenziaSedeId: 'sRev', brokerId: 'bMadre', codicePratica: 'PV-2026-1',
  veicoli: [{ targa: 'AB123CD' }],
};

describe('revocaERimettiInCircoloAction', () => {
  it('rifiuta i non super-admin', async () => {
    authMock.mockResolvedValue({ user: { id: 'x', role: 'ASSISTENTE' } });
    const res = await revocaERimettiInCircoloAction('p1', 'x');
    expect(res.ok).toBe(false);
    expect(transactionMock).not.toHaveBeenCalled();
    expect(ring1Mock).not.toHaveBeenCalled();
  });

  it('rifiuta se la pratica non è accettata/non lavorata', async () => {
    authMock.mockResolvedValue({ user: { id: 'adm', role: 'ADMIN_PIATTAFORMA' } });
    txMock.pratica.findUnique.mockResolvedValue({ ...praticaAccettata, stato: 'PROCESSATA' });
    const res = await revocaERimettiInCircoloAction('p1');
    expect(res.ok).toBe(false);
    expect(ring1Mock).not.toHaveBeenCalled();
  });

  it('happy path: revoca, riporta in IN_DISTRIBUZIONE, riavvia ring1 e invia le notifiche', async () => {
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
    // pratica sganciata + ciclo incrementato + stato IN_DISTRIBUZIONE + reset espansione v2 (CAS)
    expect(txMock.pratica.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'p1', stato: 'ACCETTATA', processataAt: null, distribuzioneCiclo: 1 }),
        data: expect.objectContaining({
          stato: 'IN_DISTRIBUZIONE',
          agenziaAssegnataId: null,
          distribuzioneCiclo: 2,
          accettataAt: null,
          raggioCorrenteM: null,
          ultimaEspansioneAt: null,
          zonaNonCopertaAt: null,
        }),
      }),
    );
    // ring1 sul nuovo ciclo (transazione propria) DOPO il commit della revoca
    expect(ring1Mock).toHaveBeenCalledWith('p1');
    // log RECIRCULATE → IN_DISTRIBUZIONE
    expect(logMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        statoA: 'IN_DISTRIBUZIONE',
        tipoEvento: 'RECIRCULATE',
        meta: expect.objectContaining({ ciclo: 2, revokedSedeId: 'sRev' }),
      }),
    );
    // N50 all'agenzia + N51 al broker + clienti + evento
    const tipiInviati = sendMock.mock.calls.map((c) => c[0].tipo);
    expect(tipiInviati).toContain('N50_AGENZIA_PRATICA_REVOCATA');
    expect(tipiInviati).toContain('N51_BROKER_PRATICA_RIMESSA_IN_CIRCOLO');
    expect(notifyClientiMock).toHaveBeenCalledWith('p1', 'RIMESSA_IN_CIRCOLO');
    expect(emitEventoMock).toHaveBeenCalled();
  });

  it('ring1 che fallisce non blocca la revoca né le notifiche (best-effort, il cron espande)', async () => {
    authMock.mockResolvedValue({ user: { id: 'adm', role: 'ADMIN_PIATTAFORMA' } });
    txMock.pratica.findUnique.mockResolvedValue(praticaAccettata);
    ring1Mock.mockRejectedValue(new Error('DB blip su ring1'));

    const res = await revocaERimettiInCircoloAction('p1', 'ferma da giorni');

    expect(res.ok).toBe(true);
    const tipiInviati = sendMock.mock.calls.map((c) => c[0].tipo);
    expect(tipiInviati).toContain('N50_AGENZIA_PRATICA_REVOCATA');
    expect(tipiInviati).toContain('N51_BROKER_PRATICA_RIMESSA_IN_CIRCOLO');
  });
});
