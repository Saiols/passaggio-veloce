import { describe, it, expect, vi, beforeEach } from 'vitest';

const contactFindMany = vi.fn();
const contactUpdate = vi.fn();
const companyFindUnique = vi.fn();
const praticaCount = vi.fn();
const userFindFirst = vi.fn();
vi.mock('@pv/db', () => ({
  prisma: {
    crmContact: {
      findMany: (...a: unknown[]) => contactFindMany(...a),
      update: (...a: unknown[]) => contactUpdate(...a),
    },
    company: { findUnique: (...a: unknown[]) => companyFindUnique(...a) },
    pratica: { count: (...a: unknown[]) => praticaCount(...a) },
    user: { findFirst: (...a: unknown[]) => userFindFirst(...a) },
  },
  CrmFonteAcquisizione: { REFERRAL: 'REFERRAL' },
}));
vi.mock('./match/engine', () => ({ calcolaProposte: vi.fn() }));
vi.mock('./match/apply', () => ({ applicaProposte: vi.fn() }));

import { syncCrmFromPlatform } from './sync';

describe('syncCrmFromPlatform', () => {
  beforeEach(() => {
    contactFindMany.mockReset();
    contactUpdate.mockReset();
    companyFindUnique.mockReset();
    praticaCount.mockReset();
    userFindFirst.mockReset();
    contactFindMany.mockResolvedValue([{ id: 'k1', companyId: 'c1' }]);
    contactUpdate.mockResolvedValue({});
    praticaCount.mockResolvedValue(0);
    userFindFirst.mockResolvedValue(null);
  });

  it("conta le pratiche di un'agenzia su agenziaAssegnataId", async () => {
    companyFindUnique.mockResolvedValue({
      type: 'AGENZIA',
      suspendedAt: null,
      deletedAt: null,
    });
    await syncCrmFromPlatform();
    for (const call of praticaCount.mock.calls) {
      expect(call[0].where).toHaveProperty('agenziaAssegnataId', 'c1');
    }
  });

  it('conta le pratiche di un broker su brokerId', async () => {
    companyFindUnique.mockResolvedValue({
      type: 'DEALER',
      suspendedAt: null,
      deletedAt: null,
    });
    await syncCrmFromPlatform();
    for (const call of praticaCount.mock.calls) {
      expect(call[0].where).toHaveProperty('brokerId', 'c1');
    }
  });

  it('agenzia con pratiche firmate → platStatus ATTIVO', async () => {
    companyFindUnique.mockResolvedValue({
      type: 'AGENZIA',
      suspendedAt: null,
      deletedAt: null,
    });
    praticaCount.mockResolvedValue(3);
    await syncCrmFromPlatform();
    expect(contactUpdate.mock.calls[0]![0].data).toMatchObject({
      platStatus: 'ATTIVO',
      praticheTotal: 3,
    });
  });
});
