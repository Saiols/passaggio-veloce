import { describe, it, expect, vi, beforeEach } from 'vitest';

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    pratica: { findUnique: vi.fn() },
    sede: { findUnique: vi.fn() },
    user: { findFirst: vi.fn() },
    userSede: { findMany: vi.fn() },
    company: { findUnique: vi.fn() },
  },
}));

vi.mock('@pv/db', () => ({ prisma: prismaMock }));
vi.mock('server-only', () => ({}));

import { destinatariBroker, destinatariAgenzia, destinatariSedeAgenzia } from './pratica';

const AZIENDA = { email: 'info@dealer.it', ragioneSociale: 'ROSSI SRL' };

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.user.findFirst.mockResolvedValue(null);
  prismaMock.userSede.findMany.mockResolvedValue([]);
  prismaMock.company.findUnique.mockResolvedValue(AZIENDA);
});

describe('destinatariBroker', () => {
  it('operatore che ha creato la pratica: lui e i colleghi della sua sede', async () => {
    prismaMock.pratica.findUnique.mockResolvedValue({
      creatoDaUserId: 'u1',
      brokerSedeId: 's1',
      brokerId: 'c1',
    });
    prismaMock.user.findFirst.mockResolvedValueOnce({
      id: 'u1',
      email: 'op@dealer.it',
      nome: 'Luca',
      role: 'UTENTE_AZIENDA',
    });
    prismaMock.userSede.findMany.mockResolvedValue([
      { user: { id: 'u2', email: 'collega@dealer.it', nome: 'Anna', role: 'UTENTE_AZIENDA' } },
    ]);

    await expect(destinatariBroker('p1')).resolves.toEqual([
      { email: 'op@dealer.it', userId: 'u1', nome: 'Luca' },
      { email: 'collega@dealer.it', userId: 'u2', nome: 'Anna' },
    ]);
  });

  it('la sede è quella della pratica, non tutta l\'azienda', async () => {
    // `brokerSedeId` è la sede scelta nel wizard: l'allargamento si ferma lì,
    // le altre filiali del dealer non ricevono nulla.
    prismaMock.pratica.findUnique.mockResolvedValue({
      creatoDaUserId: 'u1',
      brokerSedeId: 's1',
      brokerId: 'c1',
    });
    prismaMock.user.findFirst.mockResolvedValueOnce({
      id: 'u1',
      email: 'op@dealer.it',
      nome: 'Luca',
      role: 'UTENTE_AZIENDA',
    });
    prismaMock.userSede.findMany.mockResolvedValue([]);

    await destinatariBroker('p1');
    expect(prismaMock.userSede.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { sedeId: 's1', user: { status: 'ACTIVE', deletedAt: null } },
      }),
    );
  });

  it('super admin che ha creato la pratica: lui e tutta la sede da cui ha operato', async () => {
    prismaMock.pratica.findUnique.mockResolvedValue({
      creatoDaUserId: 'u4',
      brokerSedeId: 's1',
      brokerId: 'c1',
    });
    prismaMock.user.findFirst.mockResolvedValueOnce({
      id: 'u4',
      email: 'titolare@dealer.it',
      nome: 'Titolare',
      role: 'ADMIN_AZIENDA',
    });
    prismaMock.userSede.findMany.mockResolvedValue([
      { user: { id: 'u4', email: 'titolare@dealer.it', nome: 'Titolare', role: 'ADMIN_AZIENDA' } },
      { user: { id: 'u2', email: 'anna@dealer.it', nome: 'Anna', role: 'UTENTE_AZIENDA' } },
    ]);

    // il titolare compare una volta sola: la dedup lo riconosce fra i membri
    await expect(destinatariBroker('p1')).resolves.toEqual([
      { email: 'titolare@dealer.it', userId: 'u4', nome: 'Titolare' },
      { email: 'anna@dealer.it', userId: 'u2', nome: 'Anna' },
    ]);
  });

  it('creatore non più attivo → membri della sede', async () => {
    prismaMock.pratica.findUnique.mockResolvedValue({
      creatoDaUserId: 'u1',
      brokerSedeId: 's1',
      brokerId: 'c1',
    });
    // il findFirst del creatore filtra ACTIVE: non lo trova
    prismaMock.user.findFirst.mockResolvedValueOnce(null);
    prismaMock.userSede.findMany.mockResolvedValue([
      { user: { id: 'u2', email: 'anna@dealer.it', nome: 'Anna', role: 'UTENTE_AZIENDA' } },
    ]);

    await expect(destinatariBroker('p1')).resolves.toEqual([
      { email: 'anna@dealer.it', userId: 'u2', nome: 'Anna' },
    ]);
    // il filtro ACTIVE/deletedAt sul creatore deve restare: senza, un utente
    // sospeso o cancellato tornerebbe raggiungibile da questa query.
    expect(prismaMock.user.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'u1', status: 'ACTIVE', deletedAt: null } }),
    );
    // idem per i membri della sede: solo utenti attivi e non cancellati.
    expect(prismaMock.userSede.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { sedeId: 's1', user: { status: 'ACTIVE', deletedAt: null } },
      }),
    );
  });

  it('pratica storica (nessun creatore, nessuna sede) → admin azienda', async () => {
    prismaMock.pratica.findUnique.mockResolvedValue({
      creatoDaUserId: null,
      brokerSedeId: null,
      brokerId: 'c1',
    });
    prismaMock.user.findFirst.mockResolvedValueOnce({
      id: 'u4',
      email: 'admin@dealer.it',
      nome: 'Titolare',
      role: 'ADMIN_AZIENDA',
    });

    await expect(destinatariBroker('p1')).resolves.toEqual([
      { email: 'admin@dealer.it', userId: 'u4', nome: 'Titolare' },
    ]);
    // senza sede non si interroga user_sedi
    expect(prismaMock.userSede.findMany).not.toHaveBeenCalled();
    // il ruolo ADMIN_AZIENDA (oltre ad ACTIVE/deletedAt e alla company giusta)
    // deve restare nel filtro: senza, qualunque utente attivo dell'azienda
    // diventerebbe un candidato admin.
    expect(prismaMock.user.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { companyId: 'c1', role: 'ADMIN_AZIENDA', status: 'ACTIVE', deletedAt: null },
      }),
    );
  });

  it('pratica inesistente → nessun destinatario, nessuna query a valle', async () => {
    prismaMock.pratica.findUnique.mockResolvedValue(null);
    await expect(destinatariBroker('p1')).resolves.toEqual([]);
    expect(prismaMock.company.findUnique).not.toHaveBeenCalled();
  });
});

describe('destinatariAgenzia', () => {
  it('operatore che ha accettato: riceve solo lui', async () => {
    prismaMock.pratica.findUnique.mockResolvedValue({
      accettataDaUserId: 'a1',
      agenziaSedeId: 's9',
      agenziaAssegnataId: 'c9',
    });
    prismaMock.user.findFirst.mockResolvedValueOnce({
      id: 'a1',
      email: 'acc@ag.it',
      nome: 'Sara',
      role: 'UTENTE_AZIENDA',
    });
    prismaMock.userSede.findMany.mockResolvedValue([
      { user: { id: 'a2', email: 'collega@ag.it', nome: 'Gino', role: 'UTENTE_AZIENDA' } },
    ]);

    await expect(destinatariAgenzia('p1')).resolves.toEqual([
      { email: 'acc@ag.it', userId: 'a1', nome: 'Sara' },
    ]);
  });

  it('super admin che ha accettato: lui e tutta la sede assegnataria', async () => {
    prismaMock.pratica.findUnique.mockResolvedValue({
      accettataDaUserId: 'a0',
      agenziaSedeId: 's9',
      agenziaAssegnataId: 'c9',
    });
    prismaMock.user.findFirst.mockResolvedValueOnce({
      id: 'a0',
      email: 'titolare@ag.it',
      nome: 'Titolare',
      role: 'ADMIN_AZIENDA',
    });
    prismaMock.userSede.findMany.mockResolvedValue([
      { user: { id: 'a2', email: 'gino@ag.it', nome: 'Gino', role: 'UTENTE_AZIENDA' } },
    ]);

    await expect(destinatariAgenzia('p1')).resolves.toEqual([
      { email: 'titolare@ag.it', userId: 'a0', nome: 'Titolare' },
      { email: 'gino@ag.it', userId: 'a2', nome: 'Gino' },
    ]);
  });

  it('assegnazione manuale admin (accettata senza accettante) → membri della sede', async () => {
    prismaMock.pratica.findUnique.mockResolvedValue({
      accettataDaUserId: null,
      agenziaSedeId: 's9',
      agenziaAssegnataId: 'c9',
    });
    prismaMock.userSede.findMany.mockResolvedValue([
      { user: { id: 'a2', email: 'sede@ag.it', nome: 'Gino', role: 'UTENTE_AZIENDA' } },
    ]);

    await expect(destinatariAgenzia('p1')).resolves.toEqual([
      { email: 'sede@ag.it', userId: 'a2', nome: 'Gino' },
    ]);
  });

  it('pratica non ancora assegnata → nessun destinatario', async () => {
    prismaMock.pratica.findUnique.mockResolvedValue({
      accettataDaUserId: null,
      agenziaSedeId: null,
      agenziaAssegnataId: null,
    });
    await expect(destinatariAgenzia('p1')).resolves.toEqual([]);
  });
});

describe('destinatariSedeAgenzia', () => {
  it('membri della sede: nessun preferito, la pratica non è ancora presa in carico', async () => {
    prismaMock.sede.findUnique.mockResolvedValue({ companyId: 'c9' });
    prismaMock.userSede.findMany.mockResolvedValue([
      { user: { id: 'a2', email: 'sede@ag.it', nome: 'Gino', role: 'UTENTE_AZIENDA' } },
    ]);

    await expect(destinatariSedeAgenzia('s9')).resolves.toEqual([
      { email: 'sede@ag.it', userId: 'a2', nome: 'Gino' },
    ]);
    // Nessun "preferito" da cercare: l'unica findFirst è quella dell'admin azienda.
    expect(prismaMock.user.findFirst).toHaveBeenCalledTimes(1);
  });

  it('sede senza membri → admin azienda, poi email azienda', async () => {
    prismaMock.sede.findUnique.mockResolvedValue({ companyId: 'c9' });
    prismaMock.user.findFirst.mockResolvedValue(null);
    prismaMock.company.findUnique.mockResolvedValue({ email: 'info@ag.it', ragioneSociale: 'AG SRL' });

    await expect(destinatariSedeAgenzia('s9')).resolves.toEqual([
      { email: 'info@ag.it', userId: null, nome: 'AG SRL' },
    ]);
  });

  it('sede inesistente → lista vuota', async () => {
    prismaMock.sede.findUnique.mockResolvedValue(null);
    await expect(destinatariSedeAgenzia('s9')).resolves.toEqual([]);
  });
});
