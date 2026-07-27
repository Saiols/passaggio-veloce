import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/auth', () => ({
  auth: () => Promise.resolve({ user: { id: 'u1', role: 'ADMIN_PIATTAFORMA' } }),
}));
vi.mock('next/navigation', () => ({
  redirect: () => {
    throw new Error('redirect');
  },
}));
vi.mock('next/cache', () => ({ revalidatePath: () => {} }));

const contactFindMany = vi.fn();
const contactCount = vi.fn();
const campaignCreate = vi.fn();
const assegnazioneCreateMany = vi.fn();
vi.mock('@pv/db', () => ({
  Prisma: {},
  prisma: {
    crmContact: {
      findMany: (...a: unknown[]) => contactFindMany(...a),
      count: (...a: unknown[]) => contactCount(...a),
    },
    crmCampaign: { create: (...a: unknown[]) => campaignCreate(...a) },
    crmCampaignAssegnazione: {
      createMany: (...a: unknown[]) => assegnazioneCreateMany(...a),
    },
  },
}));

import { createCampaignAction } from './actions';

const BASE = {
  nome: 'Campagna Veneto',
  agentId: '11111111-1111-4111-8111-111111111111',
};

describe('createCampaignAction — target della campagna', () => {
  beforeEach(() => {
    contactFindMany.mockReset();
    contactCount.mockReset();
    campaignCreate.mockReset();
    assegnazioneCreateMany.mockReset();
    contactFindMany.mockResolvedValue([{ id: 'c1' }, { id: 'c2' }]);
    contactCount.mockResolvedValue(0);
    campaignCreate.mockResolvedValue({ id: 'camp1' });
    assegnazioneCreateMany.mockResolvedValue({ count: 2 });
  });

  // Il bot vocale propone l'iscrizione: chiamare chi è già a bordo è la cosa
  // peggiore che possa fare. Da quando la riconciliazione aggancia davvero,
  // senza questo filtro una campagna senza filtro di stato li includerebbe.
  it('esclude dal target i contatti già agganciati a un\'azienda registrata', async () => {
    await createCampaignAction(BASE);
    expect(contactFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ companyId: null }),
      }),
    );
  });

  it('l\'esclusione vale anche con i filtri attivi', async () => {
    await createCampaignAction({
      ...BASE,
      cat: 'AGENZIA',
      statoTarget: 'S3',
      regione: 'Veneto',
    });
    const where = contactFindMany.mock.calls[0]![0].where;
    expect(where.companyId).toBeNull();
    expect(where.cat).toBe('AGENZIA');
    expect(where.status).toBe('S3');
    expect(where.regione).toBeDefined();
  });

  // Il numero non deve calare in silenzio: chi lancia la campagna deve vedere
  // che mancano dei contatti e perché.
  it('riporta quanti contatti sono stati esclusi perché già registrati', async () => {
    contactCount.mockResolvedValue(7);
    const res = await createCampaignAction(BASE);
    expect(res).toEqual({ ok: true, id: 'camp1', assegnati: 2, esclusi: 7 });
  });

  it('conta gli esclusi con gli stessi filtri del target', async () => {
    await createCampaignAction({ ...BASE, cat: 'BROKER' });
    const where = contactCount.mock.calls[0]![0].where;
    expect(where.cat).toBe('BROKER');
    expect(where.deletedAt).toBeNull();
    expect(where.companyId).toEqual({ not: null });
  });

  it('assegna solo i contatti rimasti nel target', async () => {
    contactFindMany.mockResolvedValue([{ id: 'c1' }, { id: 'c2' }]);
    await createCampaignAction(BASE);
    expect(assegnazioneCreateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [
          { campaignId: 'camp1', contactId: 'c1' },
          { campaignId: 'camp1', contactId: 'c2' },
        ],
      }),
    );
  });

  it('nessun contatto nel target: campagna creata, zero assegnazioni', async () => {
    contactFindMany.mockResolvedValue([]);
    contactCount.mockResolvedValue(3);
    const res = await createCampaignAction(BASE);
    expect(res).toEqual({ ok: true, id: 'camp1', assegnati: 0, esclusi: 3 });
    expect(assegnazioneCreateMany).not.toHaveBeenCalled();
  });
});
