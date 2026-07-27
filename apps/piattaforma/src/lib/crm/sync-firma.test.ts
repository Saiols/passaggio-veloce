import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * `onPraticaFirmata` era codice morto: prima di questo branch i contatti CRM
 * agganciati erano ZERO, quindi la funzione non entrava mai e nessun test la
 * copriva. Da ora è il modulo che muove lo stato dei contatti agganciati alla
 * prima firma, ed è l'unico punto del sistema che può disfare le garanzie che
 * `match/apply.ts` difende. Questi test sono quella rete.
 *
 * Nota sui mock: si mockano SOLO `@pv/db` e il motore di match. `match/stato`
 * (funnel) e `match/storico` girano davvero — sono la fonte unica che questi
 * test devono verificare sia usata sul serio.
 */
const praticaFindUnique = vi.fn();
const praticaCount = vi.fn();
const praticaFindFirst = vi.fn();
const companyFindUnique = vi.fn();
const contactFindMany = vi.fn();
const contactUpdateMany = vi.fn();

vi.mock('@pv/db', () => ({
  prisma: {
    pratica: {
      findUnique: (...a: unknown[]) => praticaFindUnique(...a),
      count: (...a: unknown[]) => praticaCount(...a),
      findFirst: (...a: unknown[]) => praticaFindFirst(...a),
    },
    company: { findUnique: (...a: unknown[]) => companyFindUnique(...a) },
    crmContact: {
      findMany: (...a: unknown[]) => contactFindMany(...a),
      updateMany: (...a: unknown[]) => contactUpdateMany(...a),
    },
  },
  CrmFonteAcquisizione: { REFERRAL: 'REFERRAL' },
}));
vi.mock('./match/engine', () => ({ calcolaProposte: vi.fn() }));

import { onPraticaFirmata } from './sync';

/** Pratica di un broker evasa da un'agenzia: due aziende coinvolte. */
const PRATICA = {
  brokerId: 'broker1',
  agenziaAssegnataId: 'agenzia1',
  stato: 'FIRMATA',
};

const COMPANY_AGENZIA = {
  type: 'AGENZIA',
  suspendedAt: null,
  deletedAt: null,
  referenteId: null,
};

/** Solo l'agenzia ha contatti agganciati, per isolare il ramo agenzia. */
function soloAgenziaHaContatti(contatti: Array<{ id: string; status: string }>) {
  contactFindMany.mockImplementation(
    async (args: { where: { companyId: string } }) =>
      args.where.companyId === 'agenzia1' ? contatti : [],
  );
}

describe('onPraticaFirmata', () => {
  beforeEach(() => {
    praticaFindUnique.mockReset();
    praticaCount.mockReset();
    praticaFindFirst.mockReset();
    companyFindUnique.mockReset();
    contactFindMany.mockReset();
    contactUpdateMany.mockReset();
    praticaFindUnique.mockResolvedValue(PRATICA);
    companyFindUnique.mockResolvedValue(COMPANY_AGENZIA);
    praticaCount.mockResolvedValue(1);
    praticaFindFirst.mockResolvedValue({
      firmaAvvenutaAt: new Date('2026-06-01T00:00:00Z'),
    });
    contactUpdateMany.mockResolvedValue({ count: 1 });
    contactFindMany.mockResolvedValue([]);
  });

  it('pratica non firmata: non tocca nulla', async () => {
    praticaFindUnique.mockResolvedValue({ ...PRATICA, stato: 'INVIATA' });
    await onPraticaFirmata('p1');
    expect(contactFindMany).not.toHaveBeenCalled();
    expect(contactUpdateMany).not.toHaveBeenCalled();
  });

  it('pratica inesistente: non tocca nulla', async () => {
    praticaFindUnique.mockResolvedValue(null);
    await onPraticaFirmata('p1');
    expect(contactUpdateMany).not.toHaveBeenCalled();
  });

  // DIFETTO 1 — S10 (churn) è una decisione umana: nessun automatismo la
  // revoca. `apply.ts` lo protegge con un compare-and-set pieno; la vecchia
  // onPraticaFirmata scriveva S8 dalla porta accanto.
  it('non fa risorgere un contatto churned: S10 resta S10', async () => {
    soloAgenziaHaContatti([{ id: 'k1', status: 'S10' }]);
    await onPraticaFirmata('p1');
    expect(contactUpdateMany).toHaveBeenCalledTimes(1);
    expect(contactUpdateMany.mock.calls[0]![0].data.status).toBe('S10');
  });

  // DIFETTO 2 — un commerciale può aver portato a mano un contatto a S9 su
  // un'azienda con una sola firmata a sistema. Il vecchio ramo
  // `!contact.primaPratica` scriveva S8: retrocessione S9 → S8.
  it('non retrocede: un contatto a S9 con una sola firmata resta S9', async () => {
    praticaCount.mockResolvedValue(1);
    soloAgenziaHaContatti([{ id: 'k1', status: 'S9' }]);
    await onPraticaFirmata('p1');
    expect(contactUpdateMany.mock.calls[0]![0].data.status).toBe('S9');
  });

  it('avanza davvero il funnel: S7 con una firmata diventa S8', async () => {
    praticaCount.mockResolvedValue(1);
    soloAgenziaHaContatti([{ id: 'k1', status: 'S7' }]);
    await onPraticaFirmata('p1');
    expect(contactUpdateMany.mock.calls[0]![0].data).toMatchObject({
      status: 'S8',
      platStatus: 'ATTIVO',
      primaPratica: true,
      primaPraticaAt: new Date('2026-06-01T00:00:00Z'),
    });
  });

  it('due firmate: S9 (ricorrente)', async () => {
    praticaCount.mockResolvedValue(2);
    soloAgenziaHaContatti([{ id: 'k1', status: 'S7' }]);
    await onPraticaFirmata('p1');
    expect(contactUpdateMany.mock.calls[0]![0].data.status).toBe('S9');
  });

  // DIFETTO 3 — le pratiche di un'agenzia stanno su agenziaAssegnataId. La
  // vecchia versione cercava il contatto su `companyId: pratica.brokerId`:
  // le 7.880 righe agenzia della lista restavano a S7 per sempre, perché
  // syncCrmFromPlatform aggiorna gli aggregati ma non lo status e il motore
  // salta le identità già agganciate.
  it("aggiorna anche i contatti dell'agenzia assegnata, non solo del broker", async () => {
    soloAgenziaHaContatti([{ id: 'k-agenzia', status: 'S7' }]);
    await onPraticaFirmata('p1');
    expect(contactFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { companyId: 'broker1', deletedAt: null },
      }),
    );
    expect(contactFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { companyId: 'agenzia1', deletedAt: null },
      }),
    );
    expect(contactUpdateMany).toHaveBeenCalledTimes(1);
    expect(contactUpdateMany.mock.calls[0]![0].where.id).toBe('k-agenzia');
  });

  it("conta le pratiche di un'AGENZIA su agenziaAssegnataId", async () => {
    soloAgenziaHaContatti([{ id: 'k1', status: 'S7' }]);
    await onPraticaFirmata('p1');
    for (const call of praticaCount.mock.calls) {
      expect(call[0].where).toHaveProperty('agenziaAssegnataId', 'agenzia1');
    }
  });

  it('conta le pratiche di un BROKER su brokerId', async () => {
    companyFindUnique.mockResolvedValue({ ...COMPANY_AGENZIA, type: 'DEALER' });
    contactFindMany.mockImplementation(
      async (args: { where: { companyId: string } }) =>
        args.where.companyId === 'broker1' ? [{ id: 'k-broker', status: 'S7' }] : [],
    );
    await onPraticaFirmata('p1');
    for (const call of praticaCount.mock.calls) {
      expect(call[0].where).toHaveProperty('brokerId', 'broker1');
    }
  });

  // DIFETTO 4 — per decisione di progetto (spec D3) una company può avere più
  // contatti agganciati: la madre e una riga per ciascuna sede. Il vecchio
  // `findFirst` senza orderBy ne sceglieva uno a caso e lasciava gli altri
  // indietro per sempre.
  it('aggiorna TUTTI i contatti agganciati alla company, non uno solo', async () => {
    soloAgenziaHaContatti([
      { id: 'madre', status: 'S7' },
      { id: 'sede-a', status: 'S7' },
      { id: 'sede-b', status: 'S7' },
    ]);
    await onPraticaFirmata('p1');
    expect(contactUpdateMany).toHaveBeenCalledTimes(3);
    expect(contactUpdateMany.mock.calls.map((c) => c[0].where.id).sort()).toEqual([
      'madre',
      'sede-a',
      'sede-b',
    ]);
  });

  // Il ramo sospesa/cancellata mancava del tutto: la vecchia versione
  // forzava platStatus ATTIVO sempre, anche su un'azienda sospesa.
  it('azienda sospesa: platStatus SOSPESO, non ATTIVO', async () => {
    companyFindUnique.mockResolvedValue({
      ...COMPANY_AGENZIA,
      suspendedAt: new Date('2026-05-01T00:00:00Z'),
    });
    soloAgenziaHaContatti([{ id: 'k1', status: 'S7' }]);
    await onPraticaFirmata('p1');
    expect(contactUpdateMany.mock.calls[0]![0].data.platStatus).toBe('SOSPESO');
  });

  it('azienda soft-deleted: platStatus SOSPESO', async () => {
    companyFindUnique.mockResolvedValue({
      ...COMPANY_AGENZIA,
      deletedAt: new Date('2026-05-01T00:00:00Z'),
    });
    soloAgenziaHaContatti([{ id: 'k1', status: 'S7' }]);
    await onPraticaFirmata('p1');
    expect(contactUpdateMany.mock.calls[0]![0].data.platStatus).toBe('SOSPESO');
  });

  it('compare-and-set sullo stato letto e sulle righe non cancellate', async () => {
    soloAgenziaHaContatti([{ id: 'k1', status: 'S3' }]);
    await onPraticaFirmata('p1');
    expect(contactUpdateMany.mock.calls[0]![0].where).toEqual({
      id: 'k1',
      deletedAt: null,
      status: 'S3',
    });
  });

  it('pratica senza agenzia assegnata: guarda solo il broker', async () => {
    praticaFindUnique.mockResolvedValue({ ...PRATICA, agenziaAssegnataId: null });
    await onPraticaFirmata('p1');
    expect(contactFindMany).toHaveBeenCalledTimes(1);
    expect(contactFindMany.mock.calls[0]![0].where.companyId).toBe('broker1');
  });

  it('best-effort: un errore del DB non risale al motore firma', async () => {
    praticaFindUnique.mockRejectedValue(new Error('db giù'));
    await expect(onPraticaFirmata('p1')).resolves.toBeUndefined();
  });
});
