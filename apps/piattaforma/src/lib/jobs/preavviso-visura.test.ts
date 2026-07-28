import { describe, it, expect, vi, beforeEach } from 'vitest';

const { companyFindMany, notificaFindFirst, sendMock, praticaFindMany, destinatariBrokerMock } =
  vi.hoisted(() => ({
    companyFindMany: vi.fn(),
    notificaFindFirst: vi.fn(),
    sendMock: vi.fn(),
    praticaFindMany: vi.fn(),
    destinatariBrokerMock: vi.fn(
      (): Promise<{ email: string; userId: string | null; nome: string }[]> => Promise.resolve([]),
    ),
  }));
vi.mock('@pv/db', () => ({
  prisma: {
    company: { findMany: companyFindMany },
    notificaInviata: { findFirst: notificaFindFirst },
    pratica: { findMany: praticaFindMany },
  },
}));
vi.mock('@/lib/notifiche', () => ({ sendNotification: sendMock }));
vi.mock('@/lib/notifiche/pratica', () => ({ destinatariBroker: destinatariBrokerMock }));
vi.mock('@/env', () => ({ env: { NEXT_PUBLIC_APP_URL: 'https://app.test' } }));

import { preavvisoVisura } from './preavviso-visura';

const NOW = new Date('2026-06-30T08:00:00Z');
const azienda = (over: object) => ({
  id: 'c1',
  type: 'DEALER',
  ragioneSociale: 'Rossi Auto',
  visuraCameraleData: new Date('2026-01-06T00:00:00Z'), // 175 gg -> preavviso
  users: [{ id: 'u1', email: 'admin@rossi.it' }],
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  notificaFindFirst.mockResolvedValue(null);
  praticaFindMany.mockResolvedValue([]);
  companyFindMany.mockResolvedValue([]);
  destinatariBrokerMock.mockResolvedValue([]);
  // Il brief omette questo: sendMock è un vi.fn() nudo, senza .mockResolvedValue()
  // torna `undefined`, e `sendNotification(...).catch(...)` esplode con
  // "Cannot read properties of undefined (reading 'catch')" — non un fallimento
  // del provider ma un difetto del test stesso. Pattern confermato in
  // lib/fee/blocco.test.ts.
  sendMock.mockResolvedValue(undefined);
});

describe('preavvisoVisura', () => {
  it("giorno 175 -> manda N46 all'email dell'ADMIN_AZIENDA", async () => {
    companyFindMany.mockResolvedValue([azienda({})]);
    const r = await preavvisoVisura(NOW);
    expect(r.inScadenza).toBe(1);
    const call = sendMock.mock.calls[0]![0];
    expect(call.tipo).toBe('N46_VISURA_IN_SCADENZA');
    expect(call.target.email).toBe('admin@rossi.it');
    expect(call.payload.giorniRimanenti).toBe(5);
  });

  it('la query delle aziende esclude le visure nulle (esenti) a livello di where', async () => {
    companyFindMany.mockResolvedValue([]);
    await preavvisoVisura(NOW);
    const where = companyFindMany.mock.calls[0]![0].where;
    expect(where.visuraCameraleData).toEqual({ not: null });
  });

  it("N46 gia' mandata OGGI per questa visura -> non rimanda", async () => {
    companyFindMany.mockResolvedValue([azienda({})]);
    notificaFindFirst.mockResolvedValue({ id: 'n1' });
    const r = await preavvisoVisura(NOW);
    expect(r.inScadenza).toBe(0);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("la dedup e' ancorata a payload.visuraData (una visura nuova riarma il ciclo)", async () => {
    companyFindMany.mockResolvedValue([azienda({})]);
    await preavvisoVisura(NOW);
    const where = notificaFindFirst.mock.calls[0]![0].where;
    expect(JSON.stringify(where)).toContain('2026-01-06');
  });

  it('giorno 180 -> N47 (scaduta), non N46', async () => {
    companyFindMany.mockResolvedValue([
      azienda({ visuraCameraleData: new Date('2026-01-01T00:00:00Z') }),
    ]);
    const r = await preavvisoVisura(NOW);
    expect(r.scadute).toBe(1);
    expect(r.inScadenza).toBe(0);
    expect(r.congelate).toBe(0);
    const call = sendMock.mock.calls[0]![0];
    expect(call.tipo).toBe('N47_VISURA_SCADUTA');
    expect(call.payload.giorniTrascorsi).toBe(180);
  });

  it("N47 e' una-tantum per ciclo, N46 no", async () => {
    companyFindMany.mockResolvedValue([
      azienda({ visuraCameraleData: new Date('2026-01-01T00:00:00Z') }),
    ]);
    notificaFindFirst.mockResolvedValue({ id: 'gia-mandata' });
    const r = await preavvisoVisura(NOW);
    expect(r.scadute).toBe(0);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('agenzia scaduta con pratiche in volo -> N48 al broker', async () => {
    companyFindMany.mockResolvedValue([
      azienda({ type: 'AGENZIA', visuraCameraleData: new Date('2026-01-01T00:00:00Z') }),
    ]);
    praticaFindMany.mockResolvedValue([
      {
        id: 'p1',
        broker: { id: 'brk1', ragioneSociale: 'Broker X', users: [{ id: 'b1', email: 'b@x.it' }] },
      },
    ]);
    const r = await preavvisoVisura(NOW);
    expect(r.congelate).toBe(1);
    expect(sendMock.mock.calls.some((c) => c[0].tipo === 'N48_BROKER_PRATICA_CONGELATA')).toBe(true);
  });

  it('N48 va anche alla sede che lavora la pratica, non solo al titolare', async () => {
    // La visura la rinnova il titolare, ma chi ha in mano la pratica deve
    // sapere perché si è fermata invece di vederla bloccata senza spiegazione.
    companyFindMany.mockResolvedValue([
      azienda({ type: 'AGENZIA', visuraCameraleData: new Date('2026-01-01T00:00:00Z') }),
    ]);
    praticaFindMany.mockResolvedValue([
      {
        id: 'p1',
        broker: {
          id: 'brk1',
          ragioneSociale: 'Broker X',
          users: [{ id: 'b1', email: 'titolare@x.it', nome: 'Titolare' }],
        },
      },
    ]);
    destinatariBrokerMock.mockResolvedValue([
      { email: 'operatore@x.it', userId: 'op1', nome: 'Luca' },
      { email: 'collega@x.it', userId: 'op2', nome: 'Anna' },
    ]);

    const r = await preavvisoVisura(NOW);

    expect(r.congelate).toBe(1); // conta le pratiche, non le email
    expect(destinatariBrokerMock).toHaveBeenCalledWith('p1');
    const n48 = sendMock.mock.calls
      .map((c) => c[0])
      .filter((c) => c.tipo === 'N48_BROKER_PRATICA_CONGELATA');
    expect(n48.map((c) => c.target.email)).toEqual([
      'titolare@x.it',
      'operatore@x.it',
      'collega@x.it',
    ]);
    // Il nome nel testo segue il destinatario, non l'azienda.
    expect(n48.map((c) => c.payload.nomeBroker)).toEqual(['Titolare', 'Luca', 'Anna']);
  });

  it('titolare già fra i destinatari della sede: una sola N48, non due', async () => {
    // Dealer senza sedi popolate: la catena di `destinatariBroker` ricade
    // sull'admin azienda, che è lo stesso indirizzo del titolare.
    companyFindMany.mockResolvedValue([
      azienda({ type: 'AGENZIA', visuraCameraleData: new Date('2026-01-01T00:00:00Z') }),
    ]);
    praticaFindMany.mockResolvedValue([
      {
        id: 'p1',
        broker: {
          id: 'brk1',
          ragioneSociale: 'Broker X',
          users: [{ id: 'b1', email: 'titolare@x.it', nome: 'Titolare' }],
        },
      },
    ]);
    destinatariBrokerMock.mockResolvedValue([
      { email: ' TITOLARE@X.it ', userId: 'b1', nome: 'Titolare' },
    ]);

    await preavvisoVisura(NOW);

    const n48 = sendMock.mock.calls
      .map((c) => c[0])
      .filter((c) => c.tipo === 'N48_BROKER_PRATICA_CONGELATA');
    expect(n48).toHaveLength(1);
    expect(n48[0]!.target.email).toBe('titolare@x.it');
  });

  it("broker (DEALER) scaduto -> nessuna N48 (non e' lui a bloccare le pratiche)", async () => {
    // type DEALER di default: la scadenza del broker non deve MAI far scattare
    // N48 (quella riguarda solo l'agenzia che blocca le pratiche altrui). Se la
    // guardia "solo AGENZIA" sparisse, prisma.pratica.findMany() verrebbe
    // interrogata e questa pratica farebbe scattare una N48.
    companyFindMany.mockResolvedValue([
      azienda({ visuraCameraleData: new Date('2026-01-01T00:00:00Z') }),
    ]);
    praticaFindMany.mockResolvedValue([
      {
        id: 'p1',
        broker: { id: 'c1', ragioneSociale: 'Rossi Auto', users: [{ id: 'u1', email: 'admin@rossi.it' }] },
      },
    ]);
    const r = await preavvisoVisura(NOW);
    expect(r.scadute).toBe(1);
    expect(r.congelate).toBe(0);
    expect(praticaFindMany).not.toHaveBeenCalled();
    expect(sendMock.mock.calls.some((c) => c[0].tipo === 'N48_BROKER_PRATICA_CONGELATA')).toBe(false);
  });

  it('N48 gia mandata per questa pratica in questo ciclo -> non rimanda (N47 sì)', async () => {
    companyFindMany.mockResolvedValue([
      azienda({ type: 'AGENZIA', visuraCameraleData: new Date('2026-01-01T00:00:00Z') }),
    ]);
    praticaFindMany.mockResolvedValue([
      {
        id: 'p1',
        broker: { id: 'brk1', ragioneSociale: 'Broker X', users: [{ id: 'b1', email: 'b@x.it' }] },
      },
    ]);
    // 1a chiamata: dedup N47 a livello azienda -> non ancora mandata.
    // 2a chiamata: dedup N48 a livello pratica -> gia' mandata in questo ciclo.
    notificaFindFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'gia-n48' });
    const r = await preavvisoVisura(NOW);
    expect(r.scadute).toBe(1);
    expect(r.congelate).toBe(0);
    expect(sendMock.mock.calls.some((c) => c[0].tipo === 'N48_BROKER_PRATICA_CONGELATA')).toBe(false);
  });

  it('azienda senza data visura -> ignorata (esente)', async () => {
    companyFindMany.mockResolvedValue([]);
    const r = await preavvisoVisura(NOW);
    expect(r.inScadenza + r.scadute).toBe(0);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('azienda senza ADMIN_AZIENDA attivo -> saltata, nessun crash, nessun invio', async () => {
    companyFindMany.mockResolvedValue([azienda({ users: [] })]);
    const r = await preavvisoVisura(NOW);
    expect(r.inScadenza).toBe(0);
    expect(sendMock).not.toHaveBeenCalled();
  });
});
