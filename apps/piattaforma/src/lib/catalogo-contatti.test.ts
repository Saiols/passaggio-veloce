import { describe, it, expect, vi, beforeEach } from 'vitest';

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    pratica: { findMany: vi.fn() },
    opposizioneCatalogo: { findMany: vi.fn() },
  },
}));

vi.mock('@pv/db', () => ({ prisma: prismaMock, Prisma: {} }));

import { buildCatalogoContatti, dedupKey } from './catalogo-contatti';

/**
 * Pratica "cruda" come restituita dalla select di buildCatalogoContatti:
 * un venditore (Mario Rossi, email) + l'acquirente (Luca Bianchi, telefono).
 */
const PRATICA_BASE = {
  createdAt: new Date('2026-07-01T10:00:00Z'),
  venditori: [
    {
      isPersonaGiuridica: false,
      nome: 'Mario',
      cognome: 'Rossi',
      ragioneSociale: null,
      cf: null,
      piva: null,
      telefono: null,
      email: 'Mario.Rossi@Example.COM ',
    },
  ],
  acquirenteIsPersonaGiuridica: false,
  acquirenteNome: 'Luca',
  acquirenteCognome: 'Bianchi',
  acquirenteRagioneSociale: null,
  acquirenteCF: null,
  acquirentePIVA: null,
  acquirenteTelefono: '333 1234567',
  acquirenteEmail: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.pratica.findMany.mockResolvedValue([PRATICA_BASE]);
  prismaMock.opposizioneCatalogo.findMany.mockResolvedValue([]);
});

describe('buildCatalogoContatti — filtro opposizioni GDPR art. 21', () => {
  it('senza opposizioni, entrambi i contatti restano', async () => {
    const contatti = await buildCatalogoContatti();
    expect(contatti.map((c) => c.nominativo).sort()).toEqual(['Luca Bianchi', 'Mario Rossi']);
  });

  it('un contatto opposto sparisce dal catalogo, uno non opposto resta', async () => {
    const chiaveMario = dedupKey({
      email: PRATICA_BASE.venditori[0]!.email,
      telefono: null,
      cf: null,
      piva: null,
    });
    prismaMock.opposizioneCatalogo.findMany.mockResolvedValue([{ chiave: chiaveMario }]);

    const contatti = await buildCatalogoContatti();

    expect(contatti.find((c) => c.nominativo === 'Mario Rossi')).toBeUndefined();
    expect(contatti.find((c) => c.nominativo === 'Luca Bianchi')).toBeDefined();
  });

  it('interroga solo le opposizioni ATTIVE (revocataAt: null)', async () => {
    await buildCatalogoContatti();
    expect(prismaMock.opposizioneCatalogo.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { revocataAt: null } }),
    );
  });

  it('una opposizione revocata (assente dalla query filtrata) NON esclude il contatto', async () => {
    // Il mock riproduce il comportamento reale: la query con where revocataAt:null
    // non restituirebbe una riga revocata, quindi qui simuliamo lista vuota.
    prismaMock.opposizioneCatalogo.findMany.mockResolvedValue([]);
    const contatti = await buildCatalogoContatti();
    expect(contatti.find((c) => c.nominativo === 'Mario Rossi')).toBeDefined();
  });
});

describe('dedupKey — la chiave calcolata combacia con quella del catalogo (contratto critico)', () => {
  it('normalizza email (trim + lowercase) esattamente come il catalogo', () => {
    const chiave = dedupKey({
      email: 'Mario.Rossi@Example.COM ',
      telefono: null,
      cf: null,
      piva: null,
    });
    expect(chiave).toBe('email:mario.rossi@example.com');
  });

  it('round-trip: la chiave calcolata da un contatto reale è quella che serve per escluderlo dal catalogo', async () => {
    // 1. Calcolo indipendente della dedupKey (come farebbe l'azione admin).
    const chiaveCalcolata = dedupKey({
      email: 'Mario.Rossi@Example.COM ',
      telefono: null,
      cf: null,
      piva: null,
    });

    // 2. Il catalogo, senza opposizioni, espone il contatto con la STESSA chiave.
    const prima = await buildCatalogoContatti();
    const mario = prima.find((c) => c.nominativo === 'Mario Rossi');
    expect(mario?.key).toBe(chiaveCalcolata);

    // 3. Registrando l'opposizione con la chiave calcolata indipendentemente
    //    (non riletta da c.key), il catalogo deve escludere il contatto.
    prismaMock.opposizioneCatalogo.findMany.mockResolvedValue([{ chiave: chiaveCalcolata }]);
    const dopo = await buildCatalogoContatti();
    expect(dopo.find((c) => c.nominativo === 'Mario Rossi')).toBeUndefined();
  });
});
