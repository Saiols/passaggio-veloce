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

  it('agenzia con pratiche firmate → platStatus ATTIVO e aggregati corretti', async () => {
    companyFindUnique.mockResolvedValue({
      type: 'AGENZIA',
      suspendedAt: null,
      deletedAt: null,
    });
    // Valori scelti apposta tutti diversi fra loro (10, 4, 2, 20): uno scambio
    // fra due campi qualsiasi (es. praticheMonth <-> praticheTotal, oppure
    // tassoComp <-> uno dei due) deve far fallire l'assert, non passare per
    // coincidenza numerica. tassoComp atteso = round(2/10*100) = 20.
    const totalAgg = 10;
    const monthAgg = 4;
    const firmateAgg = 2;
    const lastLogin = new Date('2026-07-01T10:00:00.000Z');
    praticaCount.mockImplementation(
      async (args: { where: Record<string, unknown> }) => {
        if ('stato' in args.where) return firmateAgg;
        if ('createdAt' in args.where) return monthAgg;
        return totalAgg;
      },
    );
    userFindFirst.mockResolvedValue({ lastLoginAt: lastLogin });

    await syncCrmFromPlatform();

    expect(contactUpdate.mock.calls[0]![0].data).toEqual({
      platStatus: 'ATTIVO',
      praticheTotal: totalAgg,
      praticheMonth: monthAgg,
      lastAccessAt: lastLogin,
      tassoComp: 20,
    });
  });
});
