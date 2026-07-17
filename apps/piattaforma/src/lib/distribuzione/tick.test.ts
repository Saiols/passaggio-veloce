import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { tx, prismaMock } = vi.hoisted(() => {
  const tx = {
    pratica: { findUnique: vi.fn(), update: vi.fn() },
    sede: { findMany: vi.fn() },
    valutazione: { groupBy: vi.fn() },
    praticaAssegnazione: { findMany: vi.fn(), create: vi.fn() },
    orariApertura: { findMany: vi.fn() },
    chiusuraStraordinaria: { findMany: vi.fn() },
    praticaStatoLog: { create: vi.fn() },
  };
  const prismaMock = {
    $transaction: vi.fn((cb: (t: typeof tx) => unknown) => cb(tx)),
    praticaAssegnazione: { findMany: vi.fn() },
  };
  return { tx, prismaMock };
});

vi.mock('@pv/db', () => ({ prisma: prismaMock, Prisma: {} }));
vi.mock('@/lib/notifiche', () => ({
  sendNotification: vi.fn(() => Promise.resolve()),
  sendNotifications: vi.fn(() => Promise.resolve()),
  getAdminEmails: vi.fn(() => Promise.resolve([])),
}));
vi.mock('@/lib/eventi/emit', () => ({
  emitEventiPratica: vi.fn(() => Promise.resolve()),
  emitEventoPratica: vi.fn(() => Promise.resolve()),
}));
vi.mock('@/lib/notifiche/pratica', () => ({
  destinatariSedeAgenzia: vi.fn(() => Promise.resolve([])),
  destinatariBroker: vi.fn(() => Promise.resolve([])),
}));

import { avviaRound1ForPratica } from './tick';
import { sendNotifications } from '@/lib/notifiche';
import { destinatariSedeAgenzia } from '@/lib/notifiche/pratica';
import { limiteVisuraUtc } from '@/lib/visura/validita';

beforeEach(() => {
  vi.clearAllMocks();
  tx.pratica.findUnique
    .mockResolvedValueOnce({ id: 'p1', provincia: 'VE', assegnazioni: [] })
    .mockResolvedValueOnce({ stato: 'IN_ATTESA_ROUND_1' });
  // Tre sedi: m1 ne ha due (s1, s2), m2 una (s3). Atteso: tutte e tre contattate (nessun dedup).
  tx.sede.findMany.mockResolvedValue([
    { id: 's1', createdAt: new Date('2026-01-01'), nome: 'A1', provincia: 'VE', companyId: 'm1' },
    { id: 's2', createdAt: new Date('2026-01-02'), nome: 'A2', provincia: 'VE', companyId: 'm1' },
    { id: 's3', createdAt: new Date('2026-01-03'), nome: 'B1', provincia: 'VE', companyId: 'm2' },
  ]);
  tx.valutazione.groupBy.mockResolvedValue([]);
  tx.praticaAssegnazione.findMany.mockResolvedValue([]);
  tx.orariApertura.findMany.mockResolvedValue([]);
  tx.chiusuraStraordinaria.findMany.mockResolvedValue([]);
  let n = 0;
  tx.praticaAssegnazione.create.mockImplementation(() => Promise.resolve({ id: `a${++n}` }));
  tx.pratica.update.mockResolvedValue({});
  prismaMock.praticaAssegnazione.findMany.mockResolvedValue([]);
});

describe('avviaRound1ForPratica (multi-sede: tutte le sedi in zona)', () => {
  it('seleziona SEDI agenzia attive per provincia (non Company)', async () => {
    await avviaRound1ForPratica('p1');
    expect(tx.sede.findMany).toHaveBeenCalledTimes(1);
    const where = tx.sede.findMany.mock.calls[0][0].where;
    expect(where.type).toBe('AGENZIA');
    expect(where.suspendedAt).toBeNull();
    expect(where.deletedAt).toBeNull();
  });

  it('contatta OGNI sede in zona, anche più sedi della stessa madre', async () => {
    await avviaRound1ForPratica('p1');
    const pairs = tx.praticaAssegnazione.create.mock.calls.map((c) => ({
      agenziaId: c[0].data.agenziaId,
      sedeId: c[0].data.sedeId,
    }));
    expect(pairs).toHaveLength(3); // s1, s2 (stessa madre m1), s3 — nessun dedup
    expect(pairs).toContainEqual({ agenziaId: 'm1', sedeId: 's1' });
    expect(pairs).toContainEqual({ agenziaId: 'm1', sedeId: 's2' });
    expect(pairs).toContainEqual({ agenziaId: 'm2', sedeId: 's3' });
  });
});

describe('Task 4.3: ciclo di vita visura — esclusione dalla distribuzione', () => {
  const NOW = new Date('2026-07-17T10:00:00Z');

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function daysAgo(n: number): Date {
    return new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000);
  }

  /**
   * Il mock di Prisma non applica filtri da solo: qui simuliamo la semantica
   * reale di Postgres per `where.company.{deletedAt,suspendedAt,bloccoPagamentoAt,OR}`
   * così il test discrimina davvero il verso della disuguaglianza e il ramo
   * `null`, non solo la forma del `where` costruito da tick.ts.
   */
  function mockSediConVisuraMadre(
    sedi: Array<{ id: string; companyId: string; visuraCameraleData: Date | null }>,
  ) {
    tx.sede.findMany.mockImplementation(
      (args: { where?: { company?: { OR?: Array<Record<string, unknown>> } } }) => {
        const orClauses = args?.where?.company?.OR;
        // Comparatore generico (gt/gte/lt/lte) con semantica NULL di Postgres:
        // un confronto contro una colonna NULL non è mai vero. Non capire solo
        // `gt` è voluto: se il verso venisse invertito in `lt` nel codice sotto
        // test, questo comparatore deve seguirlo fedelmente, non restare cieco.
        const passesOr = (visura: Date | null): boolean => {
          if (!orClauses) return true;
          return orClauses.some((clause) => {
            if (!('visuraCameraleData' in clause)) return false;
            const cond = clause.visuraCameraleData;
            if (cond === null) return visura === null;
            if (visura === null) return false;
            if (cond && typeof cond === 'object') {
              const c = cond as { gt?: Date; gte?: Date; lt?: Date; lte?: Date };
              if (c.gt) return visura.getTime() > c.gt.getTime();
              if (c.gte) return visura.getTime() >= c.gte.getTime();
              if (c.lt) return visura.getTime() < c.lt.getTime();
              if (c.lte) return visura.getTime() <= c.lte.getTime();
            }
            return false;
          });
        };
        const filtered = sedi.filter((s) => passesOr(s.visuraCameraleData));
        return Promise.resolve(
          filtered.map((s) => ({
            id: s.id,
            createdAt: new Date('2026-01-01'),
            nome: `Agenzia ${s.id}`,
            provincia: 'VE',
            companyId: s.companyId,
          })),
        );
      },
    );
  }

  it('il `where` filtra sulla company: OR [null esente, gt(limiteVisuraUtc(now))]', async () => {
    await avviaRound1ForPratica('p1');
    const where = tx.sede.findMany.mock.calls[0][0].where;
    expect(where.company.deletedAt).toBeNull();
    expect(where.company.suspendedAt).toBeNull();
    expect(where.company.bloccoPagamentoAt).toBeNull();
    expect(where.company.OR).toEqual([
      { visuraCameraleData: null },
      { visuraCameraleData: { gt: limiteVisuraUtc(NOW) } },
    ]);
  });

  it('sede la cui madre ha visura a 200 giorni → NON fra i candidati (scaduta)', async () => {
    mockSediConVisuraMadre([
      { id: 'sScaduta', companyId: 'mScaduta', visuraCameraleData: daysAgo(200) },
    ]);
    await avviaRound1ForPratica('p1');
    const sedeIds = tx.praticaAssegnazione.create.mock.calls.map((c) => c[0].data.sedeId);
    expect(sedeIds).toHaveLength(0);
    expect(sedeIds).not.toContain('sScaduta');
  });

  it('sede la cui madre ha visuraCameraleData a null → SÌ fra i candidati (esente)', async () => {
    mockSediConVisuraMadre([
      { id: 'sEsente', companyId: 'mEsente', visuraCameraleData: null },
    ]);
    await avviaRound1ForPratica('p1');
    const sedeIds = tx.praticaAssegnazione.create.mock.calls.map((c) => c[0].data.sedeId);
    expect(sedeIds).toContain('sEsente');
  });

  it('sede la cui madre ha visura fresca (10 giorni) → SÌ fra i candidati', async () => {
    mockSediConVisuraMadre([
      { id: 'sFresca', companyId: 'mFresca', visuraCameraleData: daysAgo(10) },
    ]);
    await avviaRound1ForPratica('p1');
    const sedeIds = tx.praticaAssegnazione.create.mock.calls.map((c) => c[0].data.sedeId);
    expect(sedeIds).toContain('sFresca');
  });
});

// Forma semplificata di SendInput per N6, solo i campi che asseriamo: evita di
// dover discriminare l'intera union di `sendNotifications` nei test.
type N6InputForTest = {
  tipo: string;
  target: { email: string; userId: string | null; companyId: string | null };
  payload: {
    codicePratica: string;
    feeCent: number;
    comune: string | null;
    provincia: string | null;
  };
};

function n6Inputs(): N6InputForTest[] {
  return vi.mocked(sendNotifications).mock.calls[0][0] as unknown as N6InputForTest[];
}

describe('N6_AGENZIA_NUOVA_PRATICA: fan-out ai membri della sede assegnataria', () => {
  it('due assegnazioni con sede e due membri ciascuna → quattro notifiche, una per coppia', async () => {
    // Una sola sede per madre, per isolare il fan-out dal test multi-sede sopra.
    tx.sede.findMany.mockResolvedValue([
      { id: 'sA', createdAt: new Date('2026-01-01'), nome: 'Agenzia A', provincia: 'VE', companyId: 'compA' },
      { id: 'sB', createdAt: new Date('2026-01-02'), nome: 'Agenzia B', provincia: 'VE', companyId: 'compB' },
    ]);

    // Query post-commit (fuori tx): indipendente da come sono state create le
    // assegnazioni, controlla direttamente cosa emitN6ForAssegnazioni riceve.
    prismaMock.praticaAssegnazione.findMany.mockResolvedValue([
      {
        id: 'a1',
        praticaId: 'p1',
        round: 1,
        countdownFineAt: new Date('2026-01-10T10:00:00Z'),
        agenzia: { id: 'compA', ragioneSociale: 'Agenzia A', email: 'agenziaA@example.com', users: [] },
        sedeId: 'sA',
        pratica: {
          codicePratica: 'PV-2026-000001',
          veicoli: [{ targa: 'AA000AA' }],
          comune: 'Venezia',
          provincia: 'VE',
          feeAgenziaCent: 5000,
        },
      },
      {
        id: 'a2',
        praticaId: 'p1',
        round: 1,
        countdownFineAt: new Date('2026-01-10T10:00:00Z'),
        agenzia: { id: 'compB', ragioneSociale: 'Agenzia B', email: 'agenziaB@example.com', users: [] },
        sedeId: 'sB',
        pratica: {
          codicePratica: 'PV-2026-000001',
          veicoli: [{ targa: 'AA000AA' }],
          comune: 'Venezia',
          provincia: 'VE',
          feeAgenziaCent: 5000,
        },
      },
    ]);

    vi.mocked(destinatariSedeAgenzia).mockImplementation((sedeId: string) => {
      if (sedeId === 'sA') {
        return Promise.resolve([
          { email: 'mario@agenziaA.it', userId: 'u1', nome: 'Mario' },
          { email: 'luigi@agenziaA.it', userId: 'u2', nome: 'Luigi' },
        ]);
      }
      if (sedeId === 'sB') {
        return Promise.resolve([
          { email: 'anna@agenziaB.it', userId: 'u3', nome: 'Anna' },
          { email: 'elsa@agenziaB.it', userId: 'u4', nome: 'Elsa' },
        ]);
      }
      return Promise.resolve([]);
    });

    await avviaRound1ForPratica('p1');

    expect(destinatariSedeAgenzia).toHaveBeenCalledTimes(2);
    expect(destinatariSedeAgenzia).toHaveBeenCalledWith('sA');
    expect(destinatariSedeAgenzia).toHaveBeenCalledWith('sB');

    expect(sendNotifications).toHaveBeenCalledTimes(1);
    const inputs = n6Inputs();
    expect(inputs).toHaveLength(4); // 2 assegnazioni × 2 membri

    const byEmail = Object.fromEntries(inputs.map((i) => [i.target.email, i]));
    expect(Object.keys(byEmail)).toHaveLength(4);

    expect(byEmail['mario@agenziaA.it'].target).toEqual({ email: 'mario@agenziaA.it', userId: 'u1', companyId: 'compA' });
    expect(byEmail['luigi@agenziaA.it'].target).toEqual({ email: 'luigi@agenziaA.it', userId: 'u2', companyId: 'compA' });
    expect(byEmail['anna@agenziaB.it'].target).toEqual({ email: 'anna@agenziaB.it', userId: 'u3', companyId: 'compB' });
    expect(byEmail['elsa@agenziaB.it'].target).toEqual({ email: 'elsa@agenziaB.it', userId: 'u4', companyId: 'compB' });

    // Il payload (dati della pratica/assegnazione) non dipende dal membro: è
    // identico per ogni notifica dello stesso fan-out.
    for (const input of inputs) {
      expect(input.tipo).toBe('N6_AGENZIA_NUOVA_PRATICA');
      expect(input.payload.codicePratica).toBe('PV-2026-000001');
      expect(input.payload.feeCent).toBe(5000);
      expect(input.payload.comune).toBe('Venezia');
      expect(input.payload.provincia).toBe('VE');
    }
  });

  it('ramo legacy (sedeId null): una sola notifica all\'admin madre, destinatariSedeAgenzia non chiamata', async () => {
    tx.sede.findMany.mockResolvedValue([
      { id: 'sL', createdAt: new Date('2026-01-01'), nome: 'Agenzia Legacy', provincia: 'VE', companyId: 'compL' },
    ]);

    prismaMock.praticaAssegnazione.findMany.mockResolvedValue([
      {
        id: 'a1',
        praticaId: 'p1',
        round: 1,
        countdownFineAt: new Date('2026-01-10T10:00:00Z'),
        agenzia: {
          id: 'compL',
          ragioneSociale: 'Agenzia Legacy',
          email: 'agenzia-legacy@example.com',
          users: [{ id: 'u-legacy', email: 'admin-legacy@example.com' }],
        },
        sedeId: null,
        pratica: {
          codicePratica: 'PV-2026-000002',
          veicoli: [],
          comune: 'Venezia',
          provincia: 'VE',
          feeAgenziaCent: 3000,
        },
      },
    ]);

    // Se il ramo legacy chiamasse comunque il risolutore di sede sarebbe un bug:
    // lo facciamo esplodere per farlo emergere subito nel test.
    vi.mocked(destinatariSedeAgenzia).mockImplementation(() => {
      throw new Error('destinatariSedeAgenzia non deve essere chiamata per assegnazioni legacy (sedeId null)');
    });

    await avviaRound1ForPratica('p1');

    expect(destinatariSedeAgenzia).not.toHaveBeenCalled();
    expect(sendNotifications).toHaveBeenCalledTimes(1);
    const inputs = n6Inputs();
    expect(inputs).toHaveLength(1);
    expect(inputs[0].target).toEqual({
      email: 'admin-legacy@example.com',
      userId: 'u-legacy',
      companyId: 'compL',
    });
  });

  it('sede senza membri attivi: destinatariSedeAgenzia torna [] → nessuna notifica per quella assegnazione, nessuna eccezione', async () => {
    tx.sede.findMany.mockResolvedValue([
      { id: 'sE', createdAt: new Date('2026-01-01'), nome: 'Agenzia Vuota', provincia: 'VE', companyId: 'compE' },
    ]);

    prismaMock.praticaAssegnazione.findMany.mockResolvedValue([
      {
        id: 'a1',
        praticaId: 'p1',
        round: 1,
        countdownFineAt: new Date('2026-01-10T10:00:00Z'),
        agenzia: { id: 'compE', ragioneSociale: 'Agenzia Vuota', email: 'vuota@example.com', users: [] },
        sedeId: 'sE',
        pratica: {
          codicePratica: 'PV-2026-000003',
          veicoli: [],
          comune: 'Venezia',
          provincia: 'VE',
          feeAgenziaCent: 4000,
        },
      },
    ]);

    vi.mocked(destinatariSedeAgenzia).mockImplementation(() => Promise.resolve([]));

    await expect(avviaRound1ForPratica('p1')).resolves.toBeDefined();

    expect(destinatariSedeAgenzia).toHaveBeenCalledWith('sE');
    expect(sendNotifications).toHaveBeenCalledTimes(1);
    expect(n6Inputs()).toEqual([]);
  });
});
