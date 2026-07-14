import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Copre `GET /api/admin/contatti/export` (CSV catalogo contatti F-05).
 *
 * NON mocka `@/lib/catalogo-contatti`: la route deve passare per la
 * implementazione REALE di `buildCatalogoContatti()` (mock solo a livello
 * Prisma), altrimenti un domani qualcuno potrebbe farla enumerare i campi
 * per conto suo — esattamente il difetto già capitato in questo repo (un
 * filtro sparito in silenzio da CSV/ZIP perché i consumer non passavano
 * dalla fonte unica). Qui verifichiamo che un contatto con opposizione
 * GDPR art. 21 attiva NON finisca nel file scaricato.
 */

const { authMock, prismaMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  prismaMock: {
    pratica: { findMany: vi.fn() },
    opposizioneCatalogo: { findMany: vi.fn() },
  },
}));

vi.mock('@pv/db', () => ({ prisma: prismaMock }));
vi.mock('@/auth', () => ({ auth: authMock }));

import { GET } from './route';

const PRATICA = {
  createdAt: new Date('2026-07-01'),
  venditori: [
    {
      isPersonaGiuridica: false,
      nome: 'Mario',
      cognome: 'Rossi',
      ragioneSociale: null,
      cf: null,
      piva: null,
      telefono: null,
      email: 'mario.rossi@example.com',
    },
  ],
  acquirenteIsPersonaGiuridica: false,
  acquirenteNome: 'Luca',
  acquirenteCognome: 'Bianchi',
  acquirenteRagioneSociale: null,
  acquirenteCF: null,
  acquirentePIVA: null,
  acquirenteTelefono: '3331234567',
  acquirenteEmail: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN_PIATTAFORMA' } });
  prismaMock.pratica.findMany.mockResolvedValue([PRATICA]);
  prismaMock.opposizioneCatalogo.findMany.mockResolvedValue([]);
});

describe('GET /api/admin/contatti/export', () => {
  it('senza sessione → 401, nessuna query', async () => {
    authMock.mockResolvedValue(null);
    const res = await GET(new Request('http://x/api/admin/contatti/export'));
    expect(res.status).toBe(401);
    expect(prismaMock.pratica.findMany).not.toHaveBeenCalled();
  });

  it('senza opposizioni, il CSV contiene entrambi i contatti', async () => {
    const res = await GET(new Request('http://x/api/admin/contatti/export'));
    const csv = await res.text();
    expect(csv).toContain('Mario Rossi');
    expect(csv).toContain('Luca Bianchi');
  });

  it('GDPR art. 21: un contatto con opposizione ATTIVA non compare nel CSV esportato', async () => {
    prismaMock.opposizioneCatalogo.findMany.mockResolvedValue([
      { chiave: 'email:mario.rossi@example.com' },
    ]);

    const res = await GET(new Request('http://x/api/admin/contatti/export'));
    const csv = await res.text();

    expect(csv).not.toContain('Mario Rossi');
    expect(csv).not.toContain('mario.rossi@example.com');
    // Il resto del catalogo resta esportabile: l'opposizione è per contatto.
    expect(csv).toContain('Luca Bianchi');
  });
});
