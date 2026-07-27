import { describe, it, expect, vi, beforeEach } from 'vitest';

const companyFindMany = vi.fn();
const contactFindMany = vi.fn();
vi.mock('@pv/db', () => ({
  prisma: {
    company: { findMany: (...a: unknown[]) => companyFindMany(...a) },
    crmContact: { findMany: (...a: unknown[]) => contactFindMany(...a) },
  },
}));

import { calcolaProposte } from './engine';

const COMPANY = {
  id: 'c1',
  type: 'AGENZIA',
  ragioneSociale: 'AGENZIA CORSICO DI CIAVARELLA ANTONIO',
  partitaIva: '06199680155',
  email: 'info@agenziacorsico.it',
  pec: 'agenziacorsico@pec.it',
  telefono: '024478712',
  indirizzo: 'Via Fiume',
  civico: '6',
  citta: 'Corsico',
  cap: '20094',
  createdAt: new Date('2026-01-10T00:00:00Z'),
  sedi: [],
};

const CONTATTO = {
  id: 'x1',
  cat: 'AGENZIA',
  nome: 'Agenzia Corsico Pratiche Auto',
  tel: '+39 02 447 8712',
  indirizzo: 'Via Fiume 6',
  citta: 'Corsico',
  cap: '20094',
  telNorm: '024478712',
  waNorm: null,
  emailNorm: null,
  pivaNorm: null,
  createdAt: new Date('2026-03-01T00:00:00Z'),
};

/** Prima findMany su crmContact = identità già coperte, seconda = candidati. */
function mockDb(opts: { coperte?: Array<{ companyId: string; sedeId: string | null }>; contatti?: unknown[] }) {
  companyFindMany.mockResolvedValue([COMPANY]);
  contactFindMany
    .mockResolvedValueOnce(opts.coperte ?? [])
    .mockResolvedValueOnce(opts.contatti ?? [CONTATTO]);
}

describe('calcolaProposte', () => {
  beforeEach(() => {
    companyFindMany.mockReset();
    contactFindMany.mockReset();
  });

  it('propone il match reale Corsico con i campi della prova', async () => {
    mockDb({});
    const proposte = await calcolaProposte();
    expect(proposte).toHaveLength(1);
    expect(proposte[0]).toMatchObject({
      contactId: 'x1',
      companyId: 'c1',
      sedeId: null,
      companyNome: 'AGENZIA CORSICO DI CIAVARELLA ANTONIO',
      cat: 'AGENZIA',
      punteggio: 80,
    });
    expect(proposte[0]!.campi).toContain('tel');
  });

  it('salta le identità già agganciate', async () => {
    mockDb({ coperte: [{ companyId: 'c1', sedeId: null }] });
    expect(await calcolaProposte()).toEqual([]);
    // niente seconda query: senza identità libere non si caricano i candidati
    expect(contactFindMany).toHaveBeenCalledTimes(1);
  });

  it('filtra su una sola azienda quando arriva companyId', async () => {
    mockDb({});
    await calcolaProposte({ companyId: 'c1' });
    expect(companyFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: 'c1' }) }),
    );
  });

  it('nessuna azienda registrata → nessuna query sui contatti', async () => {
    companyFindMany.mockResolvedValue([]);
    expect(await calcolaProposte()).toEqual([]);
    expect(contactFindMany).not.toHaveBeenCalled();
  });
});
