import { describe, it, expect, vi, beforeEach } from 'vitest';

const contactFindMany = vi.fn();
const contactUpdate = vi.fn();
const contactUpdateMany = vi.fn();
const companyFindUnique = vi.fn();
const sedeFindUnique = vi.fn();
const praticaCount = vi.fn();
const userFindFirst = vi.fn();
vi.mock('@pv/db', () => ({
  prisma: {
    crmContact: {
      findMany: (...a: unknown[]) => contactFindMany(...a),
      update: (...a: unknown[]) => contactUpdate(...a),
      updateMany: (...a: unknown[]) => contactUpdateMany(...a),
    },
    company: { findUnique: (...a: unknown[]) => companyFindUnique(...a) },
    sede: { findUnique: (...a: unknown[]) => sedeFindUnique(...a) },
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
    contactUpdateMany.mockReset();
    companyFindUnique.mockReset();
    sedeFindUnique.mockReset();
    praticaCount.mockReset();
    userFindFirst.mockReset();
    // Contatto completo di default: nessun buco, quindi i test esistenti (che
    // non parlano di arricchimento) non entrano in quel ramo e continuano a
    // verificare solo gli aggregati.
    contactFindMany.mockResolvedValue([
      {
        id: 'k1', companyId: 'c1', sedeId: null,
        email: 'a@b.it', wa: '3331234567', piva: '01234567890',
        indirizzo: 'Via Fiume 6', citta: 'Corsico', cap: '20094',
        regione: 'Lombardia', arricchitoDa: null,
      },
    ]);
    contactUpdate.mockResolvedValue({});
    contactUpdateMany.mockResolvedValue({ count: 1 });
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

  it('riempie i buchi di un contatto già agganciato', async () => {
    contactFindMany.mockResolvedValue([
      {
        id: 'x1', companyId: 'c1', sedeId: null,
        email: null, wa: null, piva: null,
        indirizzo: null, citta: null, cap: null, regione: null,
        arricchitoDa: null,
      },
    ]);
    companyFindUnique.mockResolvedValue({
      type: 'AGENZIA', suspendedAt: null, deletedAt: null,
      email: 'info@agenziacorsico.it', telefono: '02 4478712',
      partitaIva: '01234567890', indirizzo: 'Via Fiume', civico: '6',
      citta: 'Corsico', cap: '20094', provincia: 'MI',
    });
    const res = await syncCrmFromPlatform();
    expect(res.arricchiti).toBe(1);
    expect(contactUpdateMany).toHaveBeenCalledTimes(1);
    expect(contactUpdateMany.mock.calls[0]![0].data.citta).toBe('Corsico');
  });

  it('contatto senza buchi → nessuna lettura della sede, nessuna scrittura', async () => {
    contactFindMany.mockResolvedValue([
      {
        id: 'x1', companyId: 'c1', sedeId: 'sede-1',
        email: 'a@b.it', wa: '3331234567', piva: '01234567890',
        indirizzo: 'Via Fiume 6', citta: 'Corsico', cap: '20094',
        regione: 'Lombardia', arricchitoDa: 'email',
      },
    ]);
    // Company deve risolversi (altrimenti il giro salta il contatto per
    // `!company`, e l'assert su sedeFindUnique passerebbe anche senza
    // pre-controllo sui buchi — un test vero deve arrivarci davvero).
    companyFindUnique.mockResolvedValue({
      type: 'AGENZIA', suspendedAt: null, deletedAt: null,
    });
    const res = await syncCrmFromPlatform();
    expect(res.arricchiti).toBe(0);
    expect(sedeFindUnique).not.toHaveBeenCalled();
    expect(contactUpdateMany).not.toHaveBeenCalled();
  });

  it('un arricchimento che esplode non ferma il giro degli aggregati', async () => {
    contactFindMany.mockResolvedValue([
      {
        id: 'x1', companyId: 'c1', sedeId: null,
        email: null, wa: null, piva: null,
        indirizzo: null, citta: null, cap: null, regione: null,
        arricchitoDa: null,
      },
    ]);
    // Anagrafica completa: serve una patch non vuota perché applicaArricchimento
    // (e quindi updateMany, che qui esplode) venga davvero invocato.
    companyFindUnique.mockResolvedValue({
      type: 'AGENZIA', suspendedAt: null, deletedAt: null,
      email: 'info@agenziacorsico.it', telefono: '02 4478712',
      partitaIva: '01234567890', indirizzo: 'Via Fiume', civico: '6',
      citta: 'Corsico', cap: '20094', provincia: 'MI',
    });
    contactUpdateMany.mockRejectedValue(new Error('db giù'));
    const res = await syncCrmFromPlatform();
    expect(res.updated).toBe(1);
    expect(res.arricchiti).toBe(0);
  });
});
