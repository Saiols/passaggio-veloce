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
    // Usata da emitEscalationNotifications (post-commit, fuori dalla tx) quando
    // la cascade su raggio-km esaurisce i 3 anelli senza candidati. Task 5:
    // l'escalation può ora scattare in UNA sola chiamata ad avviaRound.
    pratica: { findUnique: vi.fn() },
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

// Origine pratica di default per tutti i test (Task 5: selezione a raggio-km).
// `kmLat` sposta SOLO la latitudine di uno scarto tale che `distanceKm` fra
// l'origine e il punto spostato dia esattamente `km` (Haversine con stessa
// longitudine si riduce esattamente a R * dLat_rad — nessuna approssimazione).
const LAT0 = 45;
const LNG0 = 12;
function kmLat(km: number): number {
  return LAT0 + (km / 6371) * (180 / Math.PI);
}

beforeEach(() => {
  vi.clearAllMocks();
  tx.pratica.findUnique
    .mockResolvedValueOnce({ id: 'p1', provincia: 'VE', lat: LAT0, lng: LNG0, distribuzioneCiclo: 1, assegnazioni: [] })
    .mockResolvedValueOnce({ stato: 'IN_ATTESA_ROUND_1' });
  // Tre sedi: m1 ne ha due (s1, s2), m2 una (s3). Atteso: tutte e tre contattate (nessun dedup).
  // Tutte alla stessa coordinata dell'origine (distanza 0) → dentro il raggio round 1 (2 km).
  tx.sede.findMany.mockResolvedValue([
    { id: 's1', createdAt: new Date('2026-01-01'), nome: 'A1', provincia: 'VE', lat: LAT0, lng: LNG0, companyId: 'm1' },
    { id: 's2', createdAt: new Date('2026-01-02'), nome: 'A2', provincia: 'VE', lat: LAT0, lng: LNG0, companyId: 'm1' },
    { id: 's3', createdAt: new Date('2026-01-03'), nome: 'B1', provincia: 'VE', lat: LAT0, lng: LNG0, companyId: 'm2' },
  ]);
  tx.valutazione.groupBy.mockResolvedValue([]);
  tx.praticaAssegnazione.findMany.mockResolvedValue([]);
  tx.orariApertura.findMany.mockResolvedValue([]);
  tx.chiusuraStraordinaria.findMany.mockResolvedValue([]);
  let n = 0;
  tx.praticaAssegnazione.create.mockImplementation(() => Promise.resolve({ id: `a${++n}` }));
  tx.pratica.update.mockResolvedValue({});
  prismaMock.praticaAssegnazione.findMany.mockResolvedValue([]);
  // Default: nessuna pratica trovata → emitEscalationNotifications ritorna
  // subito (early return), nessun crash quando un test fa scattare l'escalation.
  prismaMock.pratica.findUnique.mockResolvedValue(null);
});

describe('avviaRound1ForPratica (multi-sede: tutte le sedi in zona)', () => {
  it('seleziona SEDI agenzia attive per raggio-km (non Company)', async () => {
    await avviaRound1ForPratica('p1');
    expect(tx.sede.findMany).toHaveBeenCalledTimes(1);
    const where = tx.sede.findMany.mock.calls[0][0].where;
    expect(where.type).toBe('AGENZIA');
    expect(where.suspendedAt).toBeNull();
    expect(where.deletedAt).toBeNull();
    expect(where.lat).toEqual({ not: null });
    expect(where.lng).toEqual({ not: null });
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
            // Stessa coordinata dell'origine pratica: la distanza non è oggetto
            // di questi test, che isolano il filtro visura/company.
            lat: LAT0,
            lng: LNG0,
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
      { id: 'sA', createdAt: new Date('2026-01-01'), nome: 'Agenzia A', provincia: 'VE', lat: LAT0, lng: LNG0, companyId: 'compA' },
      { id: 'sB', createdAt: new Date('2026-01-02'), nome: 'Agenzia B', provincia: 'VE', lat: LAT0, lng: LNG0, companyId: 'compB' },
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
      { id: 'sL', createdAt: new Date('2026-01-01'), nome: 'Agenzia Legacy', provincia: 'VE', lat: LAT0, lng: LNG0, companyId: 'compL' },
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
      { id: 'sE', createdAt: new Date('2026-01-01'), nome: 'Agenzia Vuota', provincia: 'VE', lat: LAT0, lng: LNG0, companyId: 'compE' },
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

describe('Task 5: avviaRound a raggio-km + cascade', () => {
  it('round 1: assegna TUTTE le sedi entro 2 km, nessuna oltre (nessun cap)', async () => {
    tx.sede.findMany.mockResolvedValueOnce([
      { id: 'sVicina1', lat: kmLat(0.5), lng: LNG0, companyId: 'm1' },
      { id: 'sVicina2', lat: kmLat(1.5), lng: LNG0, companyId: 'm2' },
      { id: 'sLontana3km', lat: kmLat(3), lng: LNG0, companyId: 'm3' },
    ]);

    await avviaRound1ForPratica('p1');

    const calls = tx.praticaAssegnazione.create.mock.calls.map((c) => c[0].data);
    const sedeIds = calls.map((d) => d.sedeId).sort();
    expect(sedeIds).toEqual(['sVicina1', 'sVicina2']); // sLontana3km NON assegnata
    expect(calls.every((d) => d.round === 1)).toBe(true);
    expect(tx.pratica.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ stato: 'IN_ATTESA_ROUND_1' }) }),
    );
  });

  it('la query esclude sedi senza coordinate (where lat/lng not null) e le sedi già contattate (id notIn)', async () => {
    tx.pratica.findUnique.mockReset();
    tx.pratica.findUnique
      .mockResolvedValueOnce({
        id: 'p1',
        lat: LAT0,
        lng: LNG0,
        distribuzioneCiclo: 1,
        assegnazioni: [{ sedeId: 'sGiaContattata', ciclo: 1, esito: 'RIFIUTATA' }],
      })
      .mockResolvedValueOnce({ stato: 'IN_ATTESA_ROUND_1' });
    tx.sede.findMany.mockResolvedValueOnce([
      { id: 'sNuova', lat: LAT0, lng: LNG0, companyId: 'mNuova' },
    ]);

    await avviaRound1ForPratica('p1');

    const where = tx.sede.findMany.mock.calls[0][0].where;
    expect(where.lat).toEqual({ not: null });
    expect(where.lng).toEqual({ not: null });
    expect(where.id).toEqual({ notIn: ['sGiaContattata'] });
  });

  it('cascade: 0 sedi entro 2 km ma 1 entro 5 km → assegnata al round 2 (raggio 5), stato IN_ATTESA_ROUND_2', async () => {
    tx.pratica.findUnique.mockReset();
    tx.pratica.findUnique
      .mockResolvedValueOnce({ id: 'p1', lat: LAT0, lng: LNG0, distribuzioneCiclo: 1, assegnazioni: [] })
      .mockResolvedValueOnce({ stato: 'IN_ATTESA_ROUND_2' });
    tx.sede.findMany.mockResolvedValueOnce([
      { id: 'sMedia4km', lat: kmLat(4), lng: LNG0, companyId: 'mMedia' },
    ]);

    await avviaRound1ForPratica('p1');

    expect(tx.praticaAssegnazione.create).toHaveBeenCalledTimes(1);
    expect(tx.praticaAssegnazione.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ sedeId: 'sMedia4km', round: 2 }) }),
    );
    expect(tx.pratica.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ stato: 'IN_ATTESA_ROUND_2' }) }),
    );
  });

  it('escalation: nessuna sede entro 10 km → escalated true, stato IN_ESCALATION, nessuna assegnazione creata', async () => {
    tx.pratica.findUnique.mockReset();
    tx.pratica.findUnique
      .mockResolvedValueOnce({ id: 'p1', lat: LAT0, lng: LNG0, distribuzioneCiclo: 1, assegnazioni: [] })
      .mockResolvedValueOnce({ stato: 'IN_ESCALATION' });
    tx.sede.findMany.mockResolvedValueOnce([
      { id: 'sLontanissima12km', lat: kmLat(12), lng: LNG0, companyId: 'mLontanissima' },
    ]);

    const result = await avviaRound1ForPratica('p1');

    expect(tx.praticaAssegnazione.create).not.toHaveBeenCalled();
    expect(tx.pratica.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ stato: 'IN_ESCALATION', escalationAt: expect.any(Date) }),
      }),
    );
    expect(result.escalated).toBe(true);
  });

  it('pratica senza coordinate (guardia difensiva): escalation immediata, nessuna query sede', async () => {
    tx.pratica.findUnique.mockReset();
    tx.pratica.findUnique
      .mockResolvedValueOnce({ id: 'p1', lat: null, lng: null, distribuzioneCiclo: 1, assegnazioni: [] })
      .mockResolvedValueOnce({ stato: 'IN_ESCALATION' });

    const result = await avviaRound1ForPratica('p1');

    expect(tx.sede.findMany).not.toHaveBeenCalled();
    expect(tx.praticaAssegnazione.create).not.toHaveBeenCalled();
    expect(result.escalated).toBe(true);
    expect(tx.pratica.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ stato: 'IN_ESCALATION' }) }),
    );
  });
});
