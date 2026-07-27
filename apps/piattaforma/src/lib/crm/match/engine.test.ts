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

/**
 * Stessa azienda madre, ma con una sede reale — usata dai test di copertura
 * mirata (sede coperta ≠ madre coperta) e dai test sul mapping sedeNome.
 * La sede ha recapiti DIVERSI dalla madre apposta: così un contatto può
 * fare match solo con la sede (o solo con la madre), mai con entrambe, e i
 * due casi restano distinguibili nel test.
 */
const SEDE = {
  id: 's1',
  type: 'AGENZIA',
  nome: 'Agenzia Corsico Sede Milano',
  telefono: '0299999999',
  email: null,
  indirizzo: 'Via Sede',
  civico: '1',
  citta: 'Milano',
  cap: '20100',
  createdAt: new Date('2026-02-01T00:00:00Z'),
};

const COMPANY_CON_SEDE = { ...COMPANY, sedi: [SEDE] };

/** Contatto che fa match SOLO con la sede (telefono/città della sede, non della madre). */
const CONTATTO_SEDE = {
  id: 'x2',
  cat: 'AGENZIA',
  nome: 'Agenzia Corsico Sede Milano Pratiche',
  tel: '02 9999999',
  indirizzo: 'Via Sede 1',
  citta: 'Milano',
  cap: '20100',
  telNorm: '0299999999',
  waNorm: null,
  emailNorm: null,
  pivaNorm: null,
  createdAt: new Date('2026-03-02T00:00:00Z'),
};

/** Prima findMany su crmContact = identità già coperte, seconda = candidati. */
function mockDb(opts: {
  companies?: unknown[];
  coperte?: Array<{ companyId: string | null; sedeId: string | null }>;
  contatti?: unknown[];
}) {
  companyFindMany.mockResolvedValue(opts.companies ?? [COMPANY]);
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
      contactTel: '+39 02 447 8712',
      contactCitta: 'Corsico',
      companyId: 'c1',
      sedeId: null,
      sedeNome: null,
      companyNome: 'AGENZIA CORSICO DI CIAVARELLA ANTONIO',
      cat: 'AGENZIA',
      punteggio: 80,
    });
    expect(proposte[0]!.campi).toContain('tel');
  });

  it('interroga entrambe le query sui contatti coi where giusti', async () => {
    mockDb({});
    await calcolaProposte();
    // Prima query: identità già coperte → solo i contatti già agganciati a
    // una company. Senza questo where si riconterebbero contatti liberi
    // come "coperti" e l'idempotenza salterebbe.
    expect(contactFindMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: { deletedAt: null, companyId: { not: null } },
      }),
    );
    // Seconda query: candidati liberi con almeno una chiave forte. Senza
    // companyId:null si ripropongono contatti già agganciati; senza l'OR
    // sulle chiavi normalizzate si caricano tutti i 19k contatti invece dei
    // soli lead con una prova forte valorizzata.
    expect(contactFindMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: {
          deletedAt: null,
          companyId: null,
          OR: [
            { telNorm: { not: null } },
            { waNorm: { not: null } },
            { emailNorm: { not: null } },
            { pivaNorm: { not: null } },
          ],
        },
      }),
    );
  });

  it('identità-sede già coperta, madre no → propone solo la madre', async () => {
    // Coverage mirata: la sede (sedeId 's1') è già agganciata, la madre
    // (sedeId null) no. CONTATTO fa match solo con la madre, CONTATTO_SEDE
    // solo con la sede: se il filtro di copertura sbagliasse la chiave sul
    // ramo sede (es. ignorasse sedeId), la sede resterebbe candidata e
    // CONTATTO_SEDE genererebbe una seconda proposta indebita.
    mockDb({
      companies: [COMPANY_CON_SEDE],
      coperte: [{ companyId: 'c1', sedeId: 's1' }],
      contatti: [CONTATTO, CONTATTO_SEDE],
    });
    const proposte = await calcolaProposte();
    expect(proposte).toHaveLength(1);
    expect(proposte[0]).toMatchObject({ contactId: 'x1', sedeId: null });
  });

  it('la proposta su una sede porta il nome e i recapiti della sede', async () => {
    // Speculare al test precedente: qui è la MADRE ad essere già coperta,
    // la sede no. L'unico contatto candidato fa match solo con la sede:
    // verifica che sedeNome/contactTel/contactCitta arrivino dal contatto e
    // dalla sede giusti (uno scambio nel mapping finale passerebbe inosservato
    // se nessun test guardasse questi campi).
    mockDb({
      companies: [COMPANY_CON_SEDE],
      coperte: [{ companyId: 'c1', sedeId: null }],
      contatti: [CONTATTO_SEDE],
    });
    const proposte = await calcolaProposte();
    expect(proposte).toHaveLength(1);
    expect(proposte[0]).toMatchObject({
      contactId: 'x2',
      contactTel: '02 9999999',
      contactCitta: 'Milano',
      sedeId: 's1',
      sedeNome: 'Agenzia Corsico Sede Milano',
    });
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
