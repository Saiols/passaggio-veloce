import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { tx, prismaMock, cfgMock, orarioMock, minutiLavorativiMock } = vi.hoisted(() => {
  const tx = {
    pratica: { findUnique: vi.fn(), update: vi.fn() },
    sede: { findMany: vi.fn() },
    praticaAssegnazione: { findMany: vi.fn(), create: vi.fn(), updateMany: vi.fn(), update: vi.fn() },
    praticaStatoLog: { create: vi.fn() },
  };
  const prismaMock = {
    $transaction: vi.fn((cb: (t: typeof tx) => unknown) => cb(tx)),
    // Le letture "Step 1" e la query candidati girano FUORI dalla tx sul client
    // base: condividono i mock della tx così i test controllano un solo punto.
    sede: tx.sede,
    praticaAssegnazione: { findMany: vi.fn() },
    // pratica.findUnique: Step 1 (include → delega a tx) + N52 post-commit (select).
    // pratica.findMany: usata da tickAllPraticheInDistribuzione.
    pratica: { findUnique: vi.fn(), findMany: vi.fn() },
  };
  return {
    tx,
    prismaMock,
    cfgMock: vi.fn(),
    orarioMock: vi.fn(),
    minutiLavorativiMock: vi.fn(),
  };
});

vi.mock('@pv/db', () => ({ prisma: prismaMock, Prisma: {} }));
vi.mock('./config', () => ({ getDistribuzioneConfig: cfgMock }));
vi.mock('./orario-piattaforma', () => ({
  isOrarioLavorativo: orarioMock,
  minutiLavorativiTra: minutiLavorativiMock,
}));
vi.mock('@/lib/notifiche', () => ({
  sendNotification: vi.fn(() => Promise.resolve()),
  sendNotifications: vi.fn(() => Promise.resolve()),
}));
vi.mock('@/lib/eventi/emit', () => ({
  emitEventiPratica: vi.fn(() => Promise.resolve()),
  emitEventoPratica: vi.fn(() => Promise.resolve()),
}));
vi.mock('@/lib/notifiche/pratica', () => ({
  destinatariSedeAgenzia: vi.fn(() => Promise.resolve([])),
  destinatariBroker: vi.fn(() => Promise.resolve([])),
}));

import { avviaRound1ForPratica, tickPratica, tickAllPraticheInDistribuzione } from './tick';
import { sendNotification, sendNotifications } from '@/lib/notifiche';
import { destinatariSedeAgenzia, destinatariBroker } from '@/lib/notifiche/pratica';
import { limiteVisuraUtc } from '@/lib/visura/validita';

// Origine pratica di default. `kmLat` sposta SOLO la latitudine di uno scarto tale
// che `distanceKm` fra l'origine e il punto spostato dia esattamente `km`.
const LAT0 = 45;
const LNG0 = 12;
function kmLat(km: number): number {
  return LAT0 + (km / 6371) * (180 / Math.PI);
}

// Config di test: raggio iniziale e passo DIVERSI fra loro, così i test
// distinguono davvero il primo anello (raggioStartM) dai successivi (stepM).
const CFG = {
  raggioStartM: 500,
  stepM: 200,
  raggioMaxM: 10000,
  intervalloMin: 10,
  orariSettimana: {
    LUN: { attivo: true, inizio: '09:00', fine: '19:00' },
    MAR: { attivo: true, inizio: '09:00', fine: '19:00' },
    MER: { attivo: true, inizio: '09:00', fine: '19:00' },
    GIO: { attivo: true, inizio: '09:00', fine: '19:00' },
    VEN: { attivo: true, inizio: '09:00', fine: '19:00' },
    SAB: { attivo: false, inizio: '09:00', fine: '13:00' },
    DOM: { attivo: false, inizio: '09:00', fine: '19:00' },
  },
  festivi: [],
};

// Pratica in distribuzione (input di tickPratica).
function praticaTick(over: Record<string, unknown> = {}) {
  return {
    id: 'p1',
    stato: 'IN_DISTRIBUZIONE',
    lat: LAT0,
    lng: LNG0,
    distribuzioneCiclo: 1,
    raggioCorrenteM: 500,
    ultimaEspansioneAt: null,
    zonaNonCopertaAt: null,
    roundCorrente: 1,
    assegnazioni: [],
    ...over,
  };
}

// Pratica appena creata (input di avviaRound1ForPratica).
function praticaSubmit(over: Record<string, unknown> = {}) {
  return {
    id: 'p1',
    stato: 'BOZZA',
    lat: LAT0,
    lng: LNG0,
    distribuzioneCiclo: 1,
    roundCorrente: 0,
    assegnazioni: [],
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  cfgMock.mockResolvedValue(CFG);
  orarioMock.mockReturnValue(true);
  // Default alto: i test che non sono specificamente sul gate "durata round"
  // devono attraversarlo senza pensarci. I test del gate sovrascrivono questo
  // valore esplicitamente.
  minutiLavorativiMock.mockReturnValue(10_000);
  tx.sede.findMany.mockResolvedValue([]);
  tx.praticaAssegnazione.findMany.mockResolvedValue([]);
  tx.praticaAssegnazione.updateMany.mockResolvedValue({ count: 0 });
  tx.praticaAssegnazione.update.mockResolvedValue({});
  tx.pratica.update.mockResolvedValue({});
  tx.praticaStatoLog.create.mockResolvedValue({});
  let n = 0;
  tx.praticaAssegnazione.create.mockImplementation(() => Promise.resolve({ id: `a${++n}` }));
  prismaMock.praticaAssegnazione.findMany.mockResolvedValue([]);
  vi.mocked(destinatariBroker).mockResolvedValue([{ email: 'br@x.it', userId: 'u1', nome: 'Rossi' }]);
  // prisma.pratica.findUnique (fuori tx) ha due usi distinti, discriminati dagli args:
  //  - Step 1 di tick/ring1: usa `include` (assegnazioni) → delega al mock della tx,
  //    così ogni test imposta solo `tx.pratica.findUnique` (Step 1 e re-read coincidono).
  //  - N52 post-commit (emitZonaNonCoperta): usa `select` sui campi broker.
  prismaMock.pratica.findUnique.mockImplementation((args: { select?: unknown }) => {
    if (args?.select) {
      return Promise.resolve({
        brokerId: 'bMadre',
        brokerSedeId: null,
        codicePratica: 'PV-2026-1',
        veicoli: [{ targa: 'AA000AA' }],
      });
    }
    return tx.pratica.findUnique(args);
  });
});

describe('avviaRound1ForPratica: primo round al submit', () => {
  it('seleziona SEDI agenzia attive per raggio-km (where), non Company', async () => {
    tx.pratica.findUnique.mockResolvedValue(praticaSubmit());
    tx.sede.findMany.mockResolvedValue([
      { id: 's1', lat: LAT0, lng: LNG0, companyId: 'm1' },
    ]);

    await avviaRound1ForPratica('p1');

    const where = tx.sede.findMany.mock.calls[0][0].where;
    expect(where.type).toBe('AGENZIA');
    expect(where.suspendedAt).toBeNull();
    expect(where.deletedAt).toBeNull();
    expect(where.lat).toEqual({ not: null });
    expect(where.lng).toEqual({ not: null });
  });

  it('contatta OGNI sede entro 500 m, anche più sedi della stessa madre (no dedup); stato → IN_DISTRIBUZIONE', async () => {
    tx.pratica.findUnique.mockResolvedValue(praticaSubmit());
    tx.sede.findMany.mockResolvedValue([
      { id: 's1', lat: LAT0, lng: LNG0, companyId: 'm1' },
      { id: 's2', lat: kmLat(0.3), lng: LNG0, companyId: 'm1' },
      { id: 's3', lat: kmLat(0.45), lng: LNG0, companyId: 'm2' },
    ]);

    const res = await avviaRound1ForPratica('p1');

    const pairs = tx.praticaAssegnazione.create.mock.calls.map((c) => ({
      agenziaId: c[0].data.agenziaId,
      sedeId: c[0].data.sedeId,
      raggioMetri: c[0].data.raggioMetri,
      round: c[0].data.round,
      esito: c[0].data.esito,
    }));
    expect(pairs).toHaveLength(3);
    expect(pairs).toContainEqual({ agenziaId: 'm1', sedeId: 's1', raggioMetri: 500, round: 1, esito: 'PENDING' });
    expect(pairs).toContainEqual({ agenziaId: 'm1', sedeId: 's2', raggioMetri: 500, round: 1, esito: 'PENDING' });
    expect(pairs).toContainEqual({ agenziaId: 'm2', sedeId: 's3', raggioMetri: 500, round: 1, esito: 'PENDING' });
    expect(res.stato).toBe('IN_DISTRIBUZIONE');
    expect(res.assegnazioni).toBe(3);
    expect(tx.pratica.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          stato: 'IN_DISTRIBUZIONE',
          raggioCorrenteM: 500,
          ultimaEspansioneAt: expect.any(Date),
          zonaNonCopertaAt: null,
          roundCorrente: 1,
        }),
      }),
    );
  });

  // Il punto 2 della richiesta: un round vuoto non fa aspettare. Prima questa
  // pratica non notificava nessuno e restava ferma fino al primo tick del cron.
  it('raggio iniziale vuoto (sede a 600 m): notifica SUBITO al primo anello non vuoto (700 m), resta round 1', async () => {
    tx.pratica.findUnique.mockResolvedValue(praticaSubmit());
    tx.sede.findMany.mockResolvedValue([
      { id: 'sLontana', lat: kmLat(0.6), lng: LNG0, companyId: 'mL' },
    ]);

    const res = await avviaRound1ForPratica('p1');

    expect(res.assegnazioni).toBe(1);
    expect(tx.praticaAssegnazione.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ sedeId: 'sLontana', raggioMetri: 700, round: 1 }),
      }),
    );
    expect(tx.pratica.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          stato: 'IN_DISTRIBUZIONE',
          raggioCorrenteM: 700,
          ultimaEspansioneAt: expect.any(Date),
          roundCorrente: 1,
        }),
      }),
    );
    // La query candidati guarda fino al raggio MASSIMO, non a quello iniziale:
    // è ciò che permette di saltare gli anelli vuoti in un colpo solo.
    expect(tx.sede.findMany).toHaveBeenCalledTimes(1);
  });

  it('nessuna sede entro il raggio massimo (sede a 12 km) → zona non coperta subito + N52, nessuna assegnazione', async () => {
    tx.pratica.findUnique.mockResolvedValue(praticaSubmit());
    tx.sede.findMany.mockResolvedValue([
      { id: 'sFuoriZona', lat: kmLat(12), lng: LNG0, companyId: 'mF' },
    ]);

    const res = await avviaRound1ForPratica('p1');

    expect(res.assegnazioni).toBe(0);
    expect(res.stato).toBe('IN_DISTRIBUZIONE');
    expect(tx.praticaAssegnazione.create).not.toHaveBeenCalled();
    expect(tx.pratica.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          stato: 'IN_DISTRIBUZIONE',
          raggioCorrenteM: 10000,
          zonaNonCopertaAt: expect.any(Date),
          ultimaEspansioneAt: null,
          roundCorrente: 0,
        }),
      }),
    );
    expect(sendNotification).toHaveBeenCalledWith(
      expect.objectContaining({ tipo: 'N52_BROKER_ZONA_NON_COPERTA' }),
    );
  });

  it('pratica senza coordinate: nessuna query sede, nessuna assegnazione, zona non coperta', async () => {
    tx.pratica.findUnique.mockResolvedValue(praticaSubmit({ lat: null, lng: null }));

    const res = await avviaRound1ForPratica('p1');

    expect(tx.sede.findMany).not.toHaveBeenCalled();
    expect(tx.praticaAssegnazione.create).not.toHaveBeenCalled();
    expect(res.assegnazioni).toBe(0);
    expect(res.stato).toBe('IN_DISTRIBUZIONE');
    expect(tx.pratica.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          ultimaEspansioneAt: null,
          zonaNonCopertaAt: expect.any(Date),
        }),
      }),
    );
  });

  it('ricircolo dopo revoca (ciclo 2): il round riparte da 1', async () => {
    tx.pratica.findUnique.mockResolvedValue(
      praticaSubmit({
        stato: 'IN_DISTRIBUZIONE',
        distribuzioneCiclo: 2,
        roundCorrente: 0,
        assegnazioni: [{ sedeId: 'sRevocata', ciclo: 1, esito: 'REVOCATA_ADMIN' }],
      }),
    );
    tx.sede.findMany.mockResolvedValue([{ id: 's1', lat: LAT0, lng: LNG0, companyId: 'm1' }]);

    await avviaRound1ForPratica('p1');

    expect(tx.praticaAssegnazione.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ round: 1, ciclo: 2 }) }),
    );
    expect(tx.pratica.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ roundCorrente: 1 }) }),
    );
  });
});

describe('avviaRound1ForPratica: filtro visura camerale della madre', () => {
  const NOW = new Date('2026-07-21T10:00:00Z');

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    tx.pratica.findUnique.mockResolvedValue(praticaSubmit());
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function daysAgo(n: number): Date {
    return new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000);
  }

  // Simula la semantica reale di Postgres per `where.company.OR` così il test
  // discrimina davvero il verso della disuguaglianza e il ramo null.
  function mockSediConVisuraMadre(
    sedi: Array<{ id: string; companyId: string; visuraCameraleData: Date | null }>,
  ) {
    tx.sede.findMany.mockImplementation(
      (args: { where?: { company?: { OR?: Array<Record<string, unknown>> } } }) => {
        const orClauses = args?.where?.company?.OR;
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
        return Promise.resolve(
          sedi
            .filter((s) => passesOr(s.visuraCameraleData))
            .map((s) => ({ id: s.id, lat: LAT0, lng: LNG0, companyId: s.companyId })),
        );
      },
    );
  }

  it('il where filtra sulla company: OR [null esente, gt(limiteVisuraUtc(now))]', async () => {
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

  it('sede la cui madre ha visura a 200 giorni → NON candidata (scaduta)', async () => {
    mockSediConVisuraMadre([{ id: 'sScaduta', companyId: 'mScaduta', visuraCameraleData: daysAgo(200) }]);
    await avviaRound1ForPratica('p1');
    const sedeIds = tx.praticaAssegnazione.create.mock.calls.map((c) => c[0].data.sedeId);
    expect(sedeIds).toHaveLength(0);
  });

  it('sede la cui madre ha visuraCameraleData null → candidata (esente)', async () => {
    mockSediConVisuraMadre([{ id: 'sEsente', companyId: 'mEsente', visuraCameraleData: null }]);
    await avviaRound1ForPratica('p1');
    const sedeIds = tx.praticaAssegnazione.create.mock.calls.map((c) => c[0].data.sedeId);
    expect(sedeIds).toContain('sEsente');
  });
});

// Forma semplificata di SendInput per N6, solo i campi che asseriamo.
type N6InputForTest = {
  tipo: string;
  target: { email: string; userId: string | null; companyId: string | null };
  payload: { codicePratica: string; feeCent: number; comune: string | null; provincia: string | null };
};

function n6Inputs(): N6InputForTest[] {
  return vi.mocked(sendNotifications).mock.calls[0][0] as unknown as N6InputForTest[];
}

describe('N6_AGENZIA_NUOVA_PRATICA: fan-out ai membri della sede assegnataria', () => {
  it('due assegnazioni con sede e due membri ciascuna → quattro notifiche, una per coppia', async () => {
    tx.pratica.findUnique.mockResolvedValue(praticaSubmit());
    tx.sede.findMany.mockResolvedValue([
      { id: 'sA', lat: LAT0, lng: LNG0, companyId: 'compA' },
      { id: 'sB', lat: kmLat(0.2), lng: LNG0, companyId: 'compB' },
    ]);

    // Query post-commit (fuori tx): controlla direttamente cosa riceve emitN6.
    prismaMock.praticaAssegnazione.findMany.mockResolvedValue([
      {
        id: 'a1', praticaId: 'p1', round: 1, countdownFineAt: null, sedeId: 'sA',
        agenzia: { id: 'compA', ragioneSociale: 'Agenzia A', email: 'agenziaA@example.com', users: [] },
        pratica: { codicePratica: 'PV-2026-000001', veicoli: [{ targa: 'AA000AA' }], comune: 'Venezia', provincia: 'VE', feeAgenziaCent: 5000 },
      },
      {
        id: 'a2', praticaId: 'p1', round: 1, countdownFineAt: null, sedeId: 'sB',
        agenzia: { id: 'compB', ragioneSociale: 'Agenzia B', email: 'agenziaB@example.com', users: [] },
        pratica: { codicePratica: 'PV-2026-000001', veicoli: [{ targa: 'AA000AA' }], comune: 'Venezia', provincia: 'VE', feeAgenziaCent: 5000 },
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
    expect(sendNotifications).toHaveBeenCalledTimes(1);
    const inputs = n6Inputs();
    expect(inputs).toHaveLength(4);
    const byEmail = Object.fromEntries(inputs.map((i) => [i.target.email, i]));
    expect(byEmail['mario@agenziaA.it'].target).toEqual({ email: 'mario@agenziaA.it', userId: 'u1', companyId: 'compA' });
    expect(byEmail['elsa@agenziaB.it'].target).toEqual({ email: 'elsa@agenziaB.it', userId: 'u4', companyId: 'compB' });
    for (const input of inputs) {
      expect(input.tipo).toBe('N6_AGENZIA_NUOVA_PRATICA');
      expect(input.payload.codicePratica).toBe('PV-2026-000001');
      expect(input.payload.feeCent).toBe(5000);
    }
  });
});

describe('tickPratica: espansione a raggio incrementale', () => {
  const NOW = new Date('2026-07-21T10:00:00Z');

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('fuori orario → noop, nessuna scrittura', async () => {
    orarioMock.mockReturnValue(false);
    tx.pratica.findUnique.mockResolvedValue(praticaTick());

    const res = await tickPratica('p1');

    expect(res).toEqual({ status: 'noop', reason: 'fuori orario' });
    expect(tx.sede.findMany).not.toHaveBeenCalled();
    expect(tx.pratica.update).not.toHaveBeenCalled();
    expect(tx.praticaAssegnazione.create).not.toHaveBeenCalled();
  });

  // Il gate ora conta i minuti LAVORATIVI (funzione mockata), non più la
  // sottrazione di calendario: `ultimaEspansioneAt` resta come documentazione
  // dello scenario, ma è `minutiLavorativiMock` a decidere l'esito.
  it('in orario ma ultima espansione 3 min lavorativi fa → noop, durata round non trascorsa', async () => {
    // Istante riconoscibile: se `da`/`a` venissero scambiati nella chiamata a
    // tickPratica, l'asserzione sugli argomenti sotto fallirebbe davvero.
    const ultimaEspansioneAt = new Date(NOW.getTime() - 3 * 60_000);
    minutiLavorativiMock.mockReturnValue(3);
    tx.pratica.findUnique.mockResolvedValue(praticaTick({ ultimaEspansioneAt }));

    const res = await tickPratica('p1');

    expect(res).toEqual({ status: 'noop', reason: 'durata round non trascorsa' });
    expect(tx.sede.findMany).not.toHaveBeenCalled();
    expect(tx.pratica.update).not.toHaveBeenCalled();

    // Il mock ignora gli argomenti e restituisce solo il valore configurato:
    // senza questo controllo, `da`/`a` scambiati (entrambi `Date`, TypeScript
    // non se ne accorgerebbe) o un `cap` sbagliato lascerebbero la suite verde
    // mentre ogni round di ogni pratica anticipa o ritarda in silenzio.
    expect(minutiLavorativiMock).toHaveBeenCalledTimes(1);
    const [da, a, , cap] = minutiLavorativiMock.mock.calls[0]!;
    expect(da).toEqual(ultimaEspansioneAt); // 1° arg: l'istante DA cui si conta, non `now`
    expect(a).toBeInstanceOf(Date);
    expect((a as Date).getTime()).toBeGreaterThan((da as Date).getTime()); // `now` è successivo
    expect(cap).toBe(CFG.intervalloMin); // 4° arg: il cap che abilita l'early-exit
  });

  // Gate 10 min con grazia (intervalloMin=10, ESPANSIONE_GRACE_MIN=0.2 → soglia 9,8 min).
  it('8 min lavorativi trascorsi → ancora noop (sotto 10-grace)', async () => {
    minutiLavorativiMock.mockReturnValue(8);
    tx.pratica.findUnique.mockResolvedValue(
      praticaTick({ raggioCorrenteM: 500, ultimaEspansioneAt: new Date(NOW.getTime() - 8 * 60_000) }),
    );

    const res = await tickPratica('p1');

    expect(res).toEqual({ status: 'noop', reason: 'durata round non trascorsa' });
    expect(tx.sede.findMany).not.toHaveBeenCalled();
  });

  it('9,8 min lavorativi trascorsi → espande (la grazia di 12s assorbe il jitter del cron)', async () => {
    minutiLavorativiMock.mockReturnValue(9.8);
    tx.pratica.findUnique.mockResolvedValue(
      praticaTick({ raggioCorrenteM: 500, ultimaEspansioneAt: new Date(NOW.getTime() - 9.8 * 60_000) }),
    );
    tx.sede.findMany.mockResolvedValue([{ id: 's1', lat: kmLat(0.65), lng: LNG0, companyId: 'm1' }]);

    const res = await tickPratica('p1');

    expect(res).toEqual({ status: 'notified', assegnazioni: 1, raggioM: 700, round: 2 });
    expect(tx.pratica.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ raggioCorrenteM: 700, ultimaEspansioneAt: NOW }),
      }),
    );
  });

  it('attende se i minuti LAVORATIVI trascorsi sono sotto la durata del round', async () => {
    cfgMock.mockResolvedValue({ ...CFG, intervalloMin: 60 });
    orarioMock.mockReturnValue(true);
    // Otto ore di calendario, ma solo 5 minuti dentro la finestra: si attende.
    minutiLavorativiMock.mockReturnValue(5);
    prismaMock.pratica.findUnique.mockResolvedValue(
      praticaTick({ ultimaEspansioneAt: new Date('2026-07-22T00:20:00Z') }),
    );

    const res = await tickPratica('p1');

    expect(res).toEqual({ status: 'noop', reason: 'durata round non trascorsa' });
    expect(prismaMock.sede.findMany).not.toHaveBeenCalled();
  });

  it('espande quando i minuti lavorativi raggiungono la durata del round', async () => {
    cfgMock.mockResolvedValue({ ...CFG, intervalloMin: 60 });
    orarioMock.mockReturnValue(true);
    minutiLavorativiMock.mockReturnValue(60);
    prismaMock.pratica.findUnique.mockResolvedValue(
      praticaTick({ ultimaEspansioneAt: new Date('2026-07-22T07:00:00Z') }),
    );
    tx.pratica.findUnique.mockResolvedValue(
      praticaTick({ ultimaEspansioneAt: new Date('2026-07-22T07:00:00Z') }),
    );
    prismaMock.sede.findMany.mockResolvedValue([
      { id: 's1', lat: kmLat(0.6), lng: LNG0, companyId: 'c1' },
    ]);
    tx.praticaAssegnazione.create.mockResolvedValue({ id: 'a1' });
    tx.pratica.update.mockResolvedValue({});
    tx.praticaStatoLog.create.mockResolvedValue({});

    const res = await tickPratica('p1');

    expect(res.status).toBe('notified');
  });

  it('la grazia è di secondi, non di un minuto intero', async () => {
    // Con durata 2 min, a 1 minuto e mezzo di lavoro NON si deve espandere:
    // la vecchia grazia da 1 minuto lo avrebbe fatto passare.
    cfgMock.mockResolvedValue({ ...CFG, intervalloMin: 2 });
    orarioMock.mockReturnValue(true);
    minutiLavorativiMock.mockReturnValue(1.5);
    prismaMock.pratica.findUnique.mockResolvedValue(
      praticaTick({ ultimaEspansioneAt: new Date('2026-07-22T07:00:00Z') }),
    );

    const res = await tickPratica('p1');

    expect(res).toEqual({ status: 'noop', reason: 'durata round non trascorsa' });
  });

  it('anello successivo con sedi → assegnazioni (raggioMetri = raggio raggiunto, PENDING), avanza raggio + round + ultimaEspansioneAt, coda N6', async () => {
    tx.pratica.findUnique.mockResolvedValue(praticaTick({ raggioCorrenteM: 500, roundCorrente: 1 }));
    tx.sede.findMany.mockResolvedValue([{ id: 's1', lat: kmLat(0.65), lng: LNG0, companyId: 'm1' }]);

    const res = await tickPratica('p1');

    // 650 m: primo anello che la include partendo da 500 è 700.
    expect(res).toEqual({ status: 'notified', assegnazioni: 1, raggioM: 700, round: 2 });
    expect(tx.praticaAssegnazione.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          sedeId: 's1',
          raggioMetri: 700,
          round: 2,
          esito: 'PENDING',
          ciclo: 1,
        }),
      }),
    );
    expect(tx.pratica.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          raggioCorrenteM: 700,
          ultimaEspansioneAt: NOW,
          roundCorrente: 2,
        }),
      }),
    );
    expect(sendNotifications).toHaveBeenCalledTimes(1); // N6
    expect(sendNotification).not.toHaveBeenCalled(); // niente N52
  });

  // Il round conta le notifiche, non i raggi: 3 anelli attraversati, 1 round.
  it('anelli vuoti intermedi → skip in un solo tick: raggio salta a 1300 (sede a 1150 m) ma il round avanza di UNO solo', async () => {
    tx.pratica.findUnique.mockResolvedValue(praticaTick({ raggioCorrenteM: 500, roundCorrente: 1 }));
    tx.sede.findMany.mockResolvedValue([{ id: 'sMedia', lat: kmLat(1.15), lng: LNG0, companyId: 'mM' }]);

    const res = await tickPratica('p1');

    expect(res).toEqual({ status: 'notified', assegnazioni: 1, raggioM: 1300, round: 2 });
    expect(tx.praticaAssegnazione.create).toHaveBeenCalledTimes(1);
    expect(tx.praticaAssegnazione.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ sedeId: 'sMedia', raggioMetri: 1300, round: 2 }),
      }),
    );
    expect(tx.pratica.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          raggioCorrenteM: 1300,
          ultimaEspansioneAt: NOW,
          roundCorrente: 2,
        }),
      }),
    );
  });

  it('nessuna sede fino al raggio max → zonaNonCopertaAt set + coda N52; PENDING preesistenti restano', async () => {
    tx.pratica.findUnique.mockResolvedValue(
      praticaTick({
        raggioCorrenteM: 500,
        assegnazioni: [{ sedeId: 'sOld', ciclo: 1, esito: 'PENDING' }],
      }),
    );
    tx.sede.findMany.mockResolvedValue([]); // nessuna sede idonea

    const res = await tickPratica('p1');

    expect(res).toEqual({ status: 'zona-non-coperta' });
    expect(tx.pratica.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ raggioCorrenteM: 10000, zonaNonCopertaAt: NOW }),
      }),
    );
    // PENDING preesistenti NON toccate.
    expect(tx.praticaAssegnazione.updateMany).not.toHaveBeenCalled();
    expect(tx.praticaAssegnazione.create).not.toHaveBeenCalled();
    // N52 al broker (non N6).
    expect(sendNotification).toHaveBeenCalledWith(
      expect.objectContaining({ tipo: 'N52_BROKER_ZONA_NON_COPERTA' }),
    );
  });

  // Compare-and-set in-tx: protegge da un'accettazione/tick/revoca concorrente
  // fra la lettura Step 1 (fuori tx) e il re-check dentro la tx. `tx.pratica.
  // findUnique` è la STESSA funzione usata sia dalla delega di Step 1 sia dal
  // re-check: due `mockResolvedValueOnce` in sequenza simulano la divergenza.
  it('race: il raggio cambia fra la lettura fuori tx e il re-check in tx → noop, nessuna scrittura', async () => {
    const primaLettura = praticaTick({ raggioCorrenteM: 500 });
    // Un altro tick (o un'accettazione) ha già fatto avanzare il raggio nel
    // frattempo: stesso ciclo, raggio diverso da quello letto allo Step 1.
    const dopoLettura = praticaTick({ raggioCorrenteM: 700 });
    tx.pratica.findUnique.mockResolvedValueOnce(primaLettura).mockResolvedValueOnce(dopoLettura);
    tx.sede.findMany.mockResolvedValue([{ id: 's1', lat: kmLat(0.65), lng: LNG0, companyId: 'm1' }]);

    const res = await tickPratica('p1');

    expect(res).toEqual({ status: 'noop', reason: 'race: stato cambiato durante il tick' });
    expect(tx.pratica.update).not.toHaveBeenCalled();
    expect(tx.praticaAssegnazione.create).not.toHaveBeenCalled();
  });

  it('race: il ciclo di distribuzione cambia (revoca admin) fra le due letture → noop, nessuna scrittura', async () => {
    const primaLettura = praticaTick({ distribuzioneCiclo: 1 });
    // Una revoca admin ha incrementato distribuzioneCiclo (ricircolo) nel
    // frattempo: stesso raggio, ciclo diverso da quello letto allo Step 1.
    const dopoLettura = praticaTick({ distribuzioneCiclo: 2 });
    tx.pratica.findUnique.mockResolvedValueOnce(primaLettura).mockResolvedValueOnce(dopoLettura);
    tx.sede.findMany.mockResolvedValue([{ id: 's1', lat: kmLat(0.65), lng: LNG0, companyId: 'm1' }]);

    const res = await tickPratica('p1');

    expect(res).toEqual({ status: 'noop', reason: 'race: stato cambiato durante il tick' });
    expect(tx.pratica.update).not.toHaveBeenCalled();
    expect(tx.praticaAssegnazione.create).not.toHaveBeenCalled();
  });

  it('pratica ACCETTATA (terminale) → closed, nessuna espansione', async () => {
    tx.pratica.findUnique.mockResolvedValue(praticaTick({ stato: 'ACCETTATA' }));

    const res = await tickPratica('p1');

    expect(res).toEqual({ status: 'closed', finalStato: 'ACCETTATA' });
    expect(tx.sede.findMany).not.toHaveBeenCalled();
    expect(tx.pratica.update).not.toHaveBeenCalled();
  });

  it('stato non gestito (BOZZA) → noop', async () => {
    tx.pratica.findUnique.mockResolvedValue(praticaTick({ stato: 'BOZZA' }));
    const res = await tickPratica('p1');
    expect(res).toEqual({ status: 'noop', reason: 'stato BOZZA non gestito' });
    expect(tx.sede.findMany).not.toHaveBeenCalled();
  });

  // zonaNonCopertaAt non è più un vicolo cieco: la pratica prosegue nel flusso
  // di ripresa. Senza sedi nuove entro il raggio massimo resta un noop senza
  // scritture (vedi il describe dedicato più sotto per il caso di successo).
  it('zonaNonCopertaAt già impostata, nessuna sede nuova → noop senza scritture (ripresa fallita)', async () => {
    tx.pratica.findUnique.mockResolvedValue(praticaTick({ zonaNonCopertaAt: NOW }));
    const res = await tickPratica('p1');
    expect(res).toEqual({ status: 'noop', reason: 'zona non coperta: nessuna sede nuova' });
    expect(tx.sede.findMany).toHaveBeenCalled();
    expect(tx.pratica.update).not.toHaveBeenCalled();
    // Regressione anti-spam: la ripresa fallita non manda una seconda N52.
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it('pratica in zona non coperta: riprende se compare una sede idonea', async () => {
    cfgMock.mockResolvedValue(CFG);
    orarioMock.mockReturnValue(true);
    minutiLavorativiMock.mockReturnValue(10_000);
    const ferma = praticaTick({
      zonaNonCopertaAt: new Date('2026-07-24T07:30:00Z'),
      raggioCorrenteM: CFG.raggioMaxM,
      roundCorrente: 3,
      ultimaEspansioneAt: new Date('2026-07-24T07:20:00Z'),
    });
    // Solo tx.pratica.findUnique: prismaMock.pratica.findUnique resta la
    // mockImplementation del beforeEach, che discrimina su `select` e delega
    // qui per lo Step 1 (`include`) — sovrascriverla romperebbe il ramo
    // `select` usato dalla N52 post-commit (broker payload).
    tx.pratica.findUnique.mockResolvedValue(ferma);
    // Agenzia registrata dopo: 0,4 km, dentro il raggio iniziale (500 m).
    prismaMock.sede.findMany.mockResolvedValue([
      { id: 'nuova', lat: kmLat(0.4), lng: LNG0, companyId: 'cN' },
    ]);
    tx.praticaAssegnazione.create.mockResolvedValue({ id: 'aN' });
    tx.pratica.update.mockResolvedValue({});
    tx.praticaStatoLog.create.mockResolvedValue({});

    const res = await tickPratica('p1');

    expect(res.status).toBe('ripresa');
    // zonaNonCopertaAt azzerato e round incrementato dal valore precedente.
    expect(tx.pratica.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ zonaNonCopertaAt: null, roundCorrente: 4 }),
      }),
    );
    // La ripresa riparte dal raggio INIZIALE, non dal massimo.
    expect(tx.praticaAssegnazione.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ sedeId: 'nuova', raggioMetri: CFG.raggioStartM }),
      }),
    );
    // Nessuna smentita della N52 già ricevuta dal broker: solo la N6 alle agenzie.
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it('pratica in zona non coperta: nessuna sede nuova → noop senza scritture', async () => {
    cfgMock.mockResolvedValue(CFG);
    orarioMock.mockReturnValue(true);
    minutiLavorativiMock.mockReturnValue(10_000);
    const ferma = praticaTick({
      zonaNonCopertaAt: new Date('2026-07-24T07:30:00Z'),
      raggioCorrenteM: CFG.raggioMaxM,
    });
    // Solo tx.pratica.findUnique (vedi commento nel test precedente).
    tx.pratica.findUnique.mockResolvedValue(ferma);
    prismaMock.sede.findMany.mockResolvedValue([]);

    const res = await tickPratica('p1');

    expect(res).toEqual({ status: 'noop', reason: 'zona non coperta: nessuna sede nuova' });
    expect(tx.pratica.update).not.toHaveBeenCalled();
    expect(tx.praticaAssegnazione.create).not.toHaveBeenCalled();
    // Regressione anti-spam: nessuna seconda N52 al broker.
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it('pratica in zona non coperta: una sede già contattata nel ciclo non la fa ripartire', async () => {
    cfgMock.mockResolvedValue(CFG);
    orarioMock.mockReturnValue(true);
    minutiLavorativiMock.mockReturnValue(10_000);
    const ferma = praticaTick({
      zonaNonCopertaAt: new Date('2026-07-24T07:30:00Z'),
      raggioCorrenteM: CFG.raggioMaxM,
      assegnazioni: [{ sedeId: 'vecchia', ciclo: 1, esito: 'RIFIUTATA' }],
    });
    // Solo tx.pratica.findUnique (vedi commento nel primo test di questo blocco).
    tx.pratica.findUnique.mockResolvedValue(ferma);
    prismaMock.sede.findMany.mockResolvedValue([]);

    const res = await tickPratica('p1');

    expect(res.status).toBe('noop');
    expect(tx.pratica.update).not.toHaveBeenCalled();
    // Regressione anti-spam: nessuna seconda N52 al broker.
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it('pratica in zona non coperta: fuori orario non riprende', async () => {
    cfgMock.mockResolvedValue(CFG);
    orarioMock.mockReturnValue(false);
    // Solo tx.pratica.findUnique (vedi commento nel primo test di questo blocco).
    tx.pratica.findUnique.mockResolvedValue(
      praticaTick({ zonaNonCopertaAt: new Date('2026-07-24T07:30:00Z') }),
    );

    const res = await tickPratica('p1');

    expect(res).toEqual({ status: 'noop', reason: 'fuori orario' });
    expect(prismaMock.sede.findMany).not.toHaveBeenCalled();
  });

  it('pratica senza lat/lng → zona non coperta (guardia, non crash), nessuna query sede', async () => {
    tx.pratica.findUnique.mockResolvedValue(praticaTick({ lat: null, lng: null }));

    const res = await tickPratica('p1');

    expect(res).toEqual({ status: 'zona-non-coperta' });
    expect(tx.sede.findMany).not.toHaveBeenCalled();
    expect(tx.pratica.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ raggioCorrenteM: 10000, zonaNonCopertaAt: NOW }),
      }),
    );
    expect(sendNotification).toHaveBeenCalledWith(
      expect.objectContaining({ tipo: 'N52_BROKER_ZONA_NON_COPERTA' }),
    );
  });

  // Le coordinate mancanti non si valorizzano mai dopo la creazione: a
  // differenza della zona non coperta "normale" qui non esiste ripresa
  // possibile. Senza questa guardia, ogni tick (ogni minuto) rimanderebbe la
  // N52 al broker all'infinito.
  it('pratica senza lat/lng già marcata zona non coperta → noop senza scritture né N52 ripetuta', async () => {
    tx.pratica.findUnique.mockResolvedValue(
      praticaTick({ lat: null, lng: null, zonaNonCopertaAt: NOW }),
    );

    const res = await tickPratica('p1');

    expect(res).toEqual({ status: 'noop', reason: 'zona non coperta: coordinate mancanti' });
    expect(tx.sede.findMany).not.toHaveBeenCalled();
    expect(tx.pratica.update).not.toHaveBeenCalled();
    expect(sendNotification).not.toHaveBeenCalled();
  });
});

describe('tickAllPraticheInDistribuzione: isolamento errori per-pratica', () => {
  it('la pratica centrale che lancia non aborta il batch; errors conteggiato', async () => {
    prismaMock.pratica.findMany.mockResolvedValue([{ id: 'pa' }, { id: 'pb' }, { id: 'pc' }]);

    // Step 1 di ogni tickPratica passa da prisma.pratica.findUnique (include, no select):
    // pa/pc → BOZZA (noop, nessuna scrittura/post-commit); pb → esplode.
    prismaMock.pratica.findUnique.mockImplementation((args: { where?: { id?: string }; select?: unknown }) => {
      if (args?.select) {
        return Promise.resolve({ brokerId: 'b', brokerSedeId: null, codicePratica: 'X', veicoli: [] });
      }
      if (args?.where?.id === 'pb') return Promise.reject(new Error('boom DB'));
      return Promise.resolve({
        id: args?.where?.id,
        stato: 'BOZZA',
        lat: LAT0,
        lng: LNG0,
        distribuzioneCiclo: 1,
        raggioCorrenteM: 500,
        ultimaEspansioneAt: null,
        zonaNonCopertaAt: null,
        assegnazioni: [],
      });
    });

    const res = await tickAllPraticheInDistribuzione();

    expect(res.scanned).toBe(3);
    expect(res.errors).toBe(1);
    // pa e pc processate nonostante il crash di pb (nessun anello espanso, sono BOZZA).
    expect(res.expanded).toBe(0);
    expect(res.zonaNonCoperta).toBe(0);
  });

  it('il cron considera anche le pratiche ferme in zona non coperta', async () => {
    prismaMock.pratica.findMany.mockResolvedValue([]);

    await tickAllPraticheInDistribuzione();

    // La where NON deve più filtrare su zonaNonCopertaAt: quelle pratiche sono
    // proprio quelle che possono ripartire quando entra una nuova agenzia.
    const where = prismaMock.pratica.findMany.mock.calls[0][0].where;
    expect(where).not.toHaveProperty('zonaNonCopertaAt');
    expect(where.stato).toBe('IN_DISTRIBUZIONE');
    expect(where.deletedAt).toBeNull();
  });

  // Una pratica ferma non esce mai da sola da IN_DISTRIBUZIONE: si accumula
  // in modo monotono. Senza un ordine esplicito, superate le 500 del `take`
  // le pratiche ferme affamerebbero in silenzio quelle attive. L'ordinamento
  // deve mettere le attive (zonaNonCopertaAt null) sempre prima.
  it('la query ordina le pratiche ATTIVE prima di quelle ferme, cosi\' il cap di 500 non affama le attive', async () => {
    prismaMock.pratica.findMany.mockResolvedValue([]);

    await tickAllPraticheInDistribuzione();

    const call = prismaMock.pratica.findMany.mock.calls[0][0];
    expect(call.orderBy).toEqual([{ zonaNonCopertaAt: { sort: 'asc', nulls: 'first' } }]);
  });
});
