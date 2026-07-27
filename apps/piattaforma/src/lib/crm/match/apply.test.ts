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

import { calcolaProposte } from './engine';
import { applicaProposte, riconciliaTutto } from './apply';

/**
 * `registrataAt` è deliberatamente DIVERSA dal `createdAt` della company
 * mockata (2026-01-10): è la data dell'identità agganciata — per un match su
 * una sede, il createdAt della SEDE. Se `apply.ts` tornasse a leggere
 * `company.createdAt`, il test su `iscrizioneAt` diventerebbe rosso.
 */
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
  registrataAt: new Date('2026-03-15T00:00:00Z'),
  ambigua: false,
};

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
    expect(esito).toEqual({ agganciati: 1, saltati: 0, errori: 0 });
    const args = contactUpdateMany.mock.calls[0]![0];
    // compare-and-set: si scrive solo se il contatto è ancora libero, se lo
    // stato è ancora quello appena letto (protegge da lost update, I-1) e se
    // la riga non è stata cancellata nel frattempo (stesso predicato dei
    // candidati in engine.ts e dell'indice unico parziale)
    expect(args.where).toEqual({
      id: 'x1',
      companyId: null,
      deletedAt: null,
      status: 'S0',
    });
    expect(args.data).toMatchObject({
      companyId: 'c1',
      sedeId: null,
      status: 'S7',
      iscrizioneComp: true,
      platStatus: 'INATTIVO',
      matchVia: 'tel+indirizzo',
    });
    expect(args.data.iscrizioneAt).toEqual(new Date('2026-03-15T00:00:00Z'));
    expect(args.data.fonte).toBeUndefined(); // storico del lead preservato
  });

  // Il compare-and-set deve escludere le righe cancellate: senza
  // `deletedAt: null` una riga soft-deleted fra il calcolo delle proposte e
  // la scrittura verrebbe aggiornata comunque e contata come agganciata,
  // mentre l'indice unico parziale e i candidati del motore la ignorano.
  it('il CAS esclude le righe soft-deleted', async () => {
    await applicaProposte([PROPOSTA]);
    expect(contactUpdateMany.mock.calls[0]![0].where).toHaveProperty(
      'deletedAt',
      null,
    );
  });

  it("iscrizioneAt è la data dell'identità agganciata, non della madre", async () => {
    await applicaProposte([
      { ...PROPOSTA, sedeId: 's1', registrataAt: new Date('2026-05-20T00:00:00Z') },
    ]);
    expect(contactUpdateMany.mock.calls[0]![0].data.iscrizioneAt).toEqual(
      new Date('2026-05-20T00:00:00Z'),
    );
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

  // review giro 2/5: coperto solo suspendedAt, non deletedAt — un'azienda
  // soft-deleted risulterebbe ATTIVO/INATTIVO invece che SOSPESO.
  it('azienda soft-deleted (deletedAt) → platStatus SOSPESO anche senza suspendedAt', async () => {
    companyFindUnique.mockResolvedValue({
      createdAt: new Date('2026-01-10T00:00:00Z'),
      suspendedAt: null,
      deletedAt: new Date('2026-06-01T00:00:00Z'),
      referenteId: null,
    });
    await applicaProposte([PROPOSTA]);
    expect(contactUpdateMany.mock.calls[0]![0].data.platStatus).toBe('SOSPESO');
  });

  // review giro 2/5: matchedAt è il timbro d'audit dell'aggancio, consumato
  // dalle viste admin dei Task 11-12 — nessun test lo verificava.
  it('valorizza matchedAt come timbro d\'audit dell\'aggancio', async () => {
    await applicaProposte([PROPOSTA]);
    expect(contactUpdateMany.mock.calls[0]![0].data.matchedAt).toBeInstanceOf(Date);
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

  // La scrittura non passata NON è un successo silenzioso: è l'unico feedback
  // di un'operazione irreversibile e va contata a parte dagli errori.
  it('contatto già preso da un altro giro: conta fra i saltati, non fra gli agganciati', async () => {
    contactUpdateMany.mockResolvedValue({ count: 0 });
    expect(await applicaProposte([PROPOSTA])).toEqual({
      agganciati: 0,
      saltati: 1,
      errori: 0,
    });
  });

  it('contatto sparito fra calcolo e scrittura: conta fra i saltati', async () => {
    contactFindUnique.mockResolvedValue(null);
    expect(await applicaProposte([PROPOSTA])).toEqual({
      agganciati: 0,
      saltati: 1,
      errori: 0,
    });
    expect(contactUpdateMany).not.toHaveBeenCalled();
  });

  it('un errore su una proposta non ferma le altre, e viene loggato con l\'id coinvolto', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    contactUpdateMany
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ count: 1 });
    const esito = await applicaProposte([PROPOSTA, { ...PROPOSTA, contactId: 'x2' }]);
    expect(esito).toEqual({ agganciati: 1, saltati: 0, errori: 1 });
    // I-4 (review giro 1/5): l'errore non va inghiottito in silenzio, va
    // loggato con l'id della proposta per poterlo diagnosticare dal cron.
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining('x1'),
      expect.any(Error),
    );
    consoleError.mockRestore();
  });

  // I-1 (review giro 1/5): il CAS deve portare nel `where` lo stato appena
  // letto, non un valore fisso — altrimenti un lost update concorrente
  // (es. un admin che porta il contatto a S10 fra la lettura e la scrittura)
  // vince in silenzio. Uso uno stato diverso da 'S0' (il default del mock)
  // apposta: un'implementazione che avesse hardcodato 'S0' nel `where`
  // passerebbe comunque gli altri test, ma non questo.
  it('il CAS porta nel where lo stato appena letto, non un valore fisso', async () => {
    contactFindUnique.mockResolvedValue({ status: 'S3' });
    await applicaProposte([PROPOSTA]);
    expect(contactUpdateMany.mock.calls[0]![0].where).toEqual({
      id: 'x1',
      companyId: null,
      deletedAt: null,
      status: 'S3',
    });
  });

  // I-2 (review giro 1/5): nessuna delle fixture precedenti aveva sedeId
  // valorizzato, quindi `sedeId: p.sedeId` poteva diventare `sedeId: null`
  // senza che nessun test se ne accorgesse — il campo che regge il
  // multi-sede non era verificato da nulla.
  it('scrive il sedeId della proposta quando il match è su una sede specifica', async () => {
    await applicaProposte([{ ...PROPOSTA, sedeId: 's1' }]);
    expect(contactUpdateMany.mock.calls[0]![0].data.sedeId).toBe('s1');
  });

  // I-2: la prima pratica deve essere la più vecchia, non l'ultima —
  // altrimenti `primaPraticaAt` mostrerebbe la pratica sbagliata.
  it('cerca la prima pratica ordinando per data crescente (la più vecchia)', async () => {
    await applicaProposte([PROPOSTA]);
    expect(praticaFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { firmaAvvenutaAt: 'asc' } }),
    );
  });

  // I-2: le pratiche cancellate non devono contribuire allo storico,
  // altrimenti S8/S9 e primaPratica si baserebbero su dati falsati.
  it('esclude le pratiche cancellate dal conteggio e dalla ricerca della prima', async () => {
    await applicaProposte([PROPOSTA]);
    expect(praticaCount).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ deletedAt: null }) }),
    );
    expect(praticaFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ deletedAt: null }) }),
    );
  });

  // I-2: con zero pratiche firmate primaPratica deve restare false, non
  // diventare vera a prescindere.
  it('primaPratica resta false quando l\'azienda non ha ancora firmato nulla', async () => {
    praticaCount.mockResolvedValue(0);
    praticaFindFirst.mockResolvedValue(null);
    await applicaProposte([PROPOSTA]);
    expect(contactUpdateMany.mock.calls[0]![0].data.primaPratica).toBe(false);
  });
});

// I-3 (review giro 1/5): `riconciliaTutto` è la funzione che i Task 10 (cron)
// e 11 (azione admin) consumano. Il mock di './engine' era dichiarato e mai
// usato: questi test lo attivano davvero.
describe('riconciliaTutto', () => {
  beforeEach(() => {
    companyFindUnique.mockReset();
    praticaCount.mockReset();
    praticaFindFirst.mockReset();
    contactFindUnique.mockReset();
    contactUpdateMany.mockReset();
    vi.mocked(calcolaProposte).mockReset();
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

  it('calcola le proposte dal motore, le applica e riporta i conteggi', async () => {
    vi.mocked(calcolaProposte).mockResolvedValue([
      PROPOSTA,
      { ...PROPOSTA, contactId: 'x2' },
    ]);
    const esito = await riconciliaTutto();
    expect(calcolaProposte).toHaveBeenCalledTimes(1);
    expect(esito).toEqual({
      proposte: 2,
      ambigueSaltate: 0,
      agganciati: 2,
      saltati: 0,
      errori: 0,
    });
  });

  it('nessuna proposta dal motore: nessuna scrittura e conteggi a zero', async () => {
    vi.mocked(calcolaProposte).mockResolvedValue([]);
    const esito = await riconciliaTutto();
    expect(contactUpdateMany).not.toHaveBeenCalled();
    expect(esito).toEqual({
      proposte: 0,
      ambigueSaltate: 0,
      agganciati: 0,
      saltati: 0,
      errori: 0,
    });
  });

  // Il canale automatico (cron delle 02:00) non deve scrivere agganci che
  // nessuno può disfare quando la scelta è un ex aequo: le ambigue restano
  // alla pagina admin.
  it('di default NON applica le proposte ambigue', async () => {
    vi.mocked(calcolaProposte).mockResolvedValue([
      { ...PROPOSTA, contactId: 'x-amb', ambigua: true },
      { ...PROPOSTA, contactId: 'x-ok' },
    ]);
    const esito = await riconciliaTutto();
    expect(contactUpdateMany).toHaveBeenCalledTimes(1);
    expect(contactUpdateMany.mock.calls[0]![0].where.id).toBe('x-ok');
    expect(esito).toMatchObject({
      proposte: 2,
      ambigueSaltate: 1,
      agganciati: 1,
    });
  });

  // Niente tetti silenziosi: quante ne sono state lasciate indietro deve
  // stare nel valore di ritorno (finisce nel log del cron).
  it('conta esattamente le ambigue lasciate indietro', async () => {
    vi.mocked(calcolaProposte).mockResolvedValue([
      { ...PROPOSTA, contactId: 'a', ambigua: true },
      { ...PROPOSTA, contactId: 'b', ambigua: true },
      { ...PROPOSTA, contactId: 'c', ambigua: true },
      { ...PROPOSTA, contactId: 'd' },
    ]);
    const esito = await riconciliaTutto();
    expect(esito.ambigueSaltate).toBe(3);
    expect(esito.agganciati).toBe(1);
    expect(esito.proposte).toBe(4);
  });

  // L'azione della pagina admin le applica tutte: lì una persona ha appena
  // visto l'anteprima con le ambigue marcate.
  it('con includiAmbigue applica anche le ambigue', async () => {
    vi.mocked(calcolaProposte).mockResolvedValue([
      { ...PROPOSTA, contactId: 'x-amb', ambigua: true },
      { ...PROPOSTA, contactId: 'x-ok' },
    ]);
    const esito = await riconciliaTutto({ includiAmbigue: true });
    expect(contactUpdateMany).toHaveBeenCalledTimes(2);
    expect(esito).toMatchObject({
      proposte: 2,
      ambigueSaltate: 0,
      agganciati: 2,
    });
  });
});
