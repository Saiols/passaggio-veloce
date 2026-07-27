import { describe, it, expect, vi, beforeEach } from 'vitest';

const companyFindUnique = vi.fn();
const praticaCount = vi.fn();
const praticaFindFirst = vi.fn();
const contactFindUnique = vi.fn();
const contactUpdateMany = vi.fn();
vi.mock('@pv/db', () => ({
  prisma: {
    company: { findUnique: (...a: unknown[]) => companyFindUnique(...a) },
    pratica: {
      count: (...a: unknown[]) => praticaCount(...a),
      findFirst: (...a: unknown[]) => praticaFindFirst(...a),
    },
    crmContact: {
      findUnique: (...a: unknown[]) => contactFindUnique(...a),
      updateMany: (...a: unknown[]) => contactUpdateMany(...a),
    },
  },
  CrmFonteAcquisizione: { REFERRAL: 'REFERRAL' },
}));
vi.mock('./engine', () => ({ calcolaProposte: vi.fn() }));

import { applicaProposte, statoAllineato } from './apply';

const PROPOSTA = {
  contactId: 'x1',
  contactNome: 'Agenzia Corsico Pratiche Auto',
  contactTel: '+39 02 447 8712',
  contactCitta: 'Corsico',
  companyId: 'c1',
  companyNome: 'AGENZIA CORSICO',
  sedeId: null,
  sedeNome: null,
  cat: 'AGENZIA' as const,
  punteggio: 80,
  campi: ['tel', 'indirizzo'],
};

describe('statoAllineato', () => {
  it('mappa il numero di firmate sul funnel', () => {
    expect(statoAllineato('S0', 0)).toBe('S7');
    expect(statoAllineato('S0', 1)).toBe('S8');
    expect(statoAllineato('S0', 5)).toBe('S9');
  });

  it('non retrocede mai', () => {
    expect(statoAllineato('S9', 0)).toBe('S9');
    expect(statoAllineato('S8', 1)).toBe('S8');
  });

  it('non tocca il churn', () => {
    expect(statoAllineato('S10', 3)).toBe('S10');
  });
});

describe('applicaProposte', () => {
  beforeEach(() => {
    companyFindUnique.mockReset();
    praticaCount.mockReset();
    praticaFindFirst.mockReset();
    contactFindUnique.mockReset();
    contactUpdateMany.mockReset();
    contactFindUnique.mockResolvedValue({ status: 'S0' });
    companyFindUnique.mockResolvedValue({
      createdAt: new Date('2026-01-10T00:00:00Z'),
      suspendedAt: null,
      deletedAt: null,
      referenteId: null,
    });
    praticaCount.mockResolvedValue(0);
    praticaFindFirst.mockResolvedValue(null);
    contactUpdateMany.mockResolvedValue({ count: 1 });
  });

  it('scrive aggancio, stato e provenienza del match', async () => {
    const esito = await applicaProposte([PROPOSTA]);
    expect(esito).toEqual({ agganciati: 1, errori: 0 });
    const args = contactUpdateMany.mock.calls[0]![0];
    // compare-and-set: si scrive solo se il contatto è ancora libero
    expect(args.where).toEqual({ id: 'x1', companyId: null });
    expect(args.data).toMatchObject({
      companyId: 'c1',
      sedeId: null,
      status: 'S7',
      iscrizioneComp: true,
      platStatus: 'INATTIVO',
      matchVia: 'tel+indirizzo',
    });
    expect(args.data.iscrizioneAt).toEqual(new Date('2026-01-10T00:00:00Z'));
    expect(args.data.fonte).toBeUndefined(); // storico del lead preservato
  });

  it('conta le pratiche di un AGENZIA su agenziaAssegnataId', async () => {
    await applicaProposte([PROPOSTA]);
    expect(praticaCount).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ agenziaAssegnataId: 'c1', stato: 'FIRMATA' }),
      }),
    );
  });

  it('conta le pratiche di un BROKER su brokerId', async () => {
    await applicaProposte([{ ...PROPOSTA, cat: 'BROKER' }]);
    expect(praticaCount).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ brokerId: 'c1', stato: 'FIRMATA' }),
      }),
    );
  });

  it('azienda già operativa: stato S9, platStatus ATTIVO, prima pratica valorizzata', async () => {
    praticaCount.mockResolvedValue(4);
    praticaFindFirst.mockResolvedValue({ firmaAvvenutaAt: new Date('2026-02-02T00:00:00Z') });
    await applicaProposte([PROPOSTA]);
    expect(contactUpdateMany.mock.calls[0]![0].data).toMatchObject({
      status: 'S9',
      platStatus: 'ATTIVO',
      primaPratica: true,
      primaPraticaAt: new Date('2026-02-02T00:00:00Z'),
    });
  });

  it('azienda sospesa → platStatus SOSPESO', async () => {
    companyFindUnique.mockResolvedValue({
      createdAt: new Date('2026-01-10T00:00:00Z'),
      suspendedAt: new Date('2026-05-01T00:00:00Z'),
      deletedAt: null,
      referenteId: null,
    });
    await applicaProposte([PROPOSTA]);
    expect(contactUpdateMany.mock.calls[0]![0].data.platStatus).toBe('SOSPESO');
  });

  it('company arrivata da referral → fonte REFERRAL (comportamento già vivo)', async () => {
    companyFindUnique.mockResolvedValue({
      createdAt: new Date('2026-01-10T00:00:00Z'),
      suspendedAt: null,
      deletedAt: null,
      referenteId: 'c9',
    });
    await applicaProposte([PROPOSTA]);
    expect(contactUpdateMany.mock.calls[0]![0].data.fonte).toBe('REFERRAL');
  });

  it('un contatto già S9 non retrocede a S7', async () => {
    contactFindUnique.mockResolvedValue({ status: 'S9' });
    await applicaProposte([PROPOSTA]);
    expect(contactUpdateMany.mock.calls[0]![0].data.status).toBe('S9');
  });

  it('contatto già preso da un altro giro: non conta come agganciato', async () => {
    contactUpdateMany.mockResolvedValue({ count: 0 });
    expect(await applicaProposte([PROPOSTA])).toEqual({ agganciati: 0, errori: 0 });
  });

  it('un errore su una proposta non ferma le altre', async () => {
    contactUpdateMany
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ count: 1 });
    const esito = await applicaProposte([PROPOSTA, { ...PROPOSTA, contactId: 'x2' }]);
    expect(esito).toEqual({ agganciati: 1, errori: 1 });
  });
});
