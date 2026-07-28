import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * La tendina "Codice di benvenuto" dell'email di partenza mostrava solo
 * "Nessun codice" quando in piattaforma i codici c'erano ma erano tutti
 * scaduti/esauriti/disattivati: indistinguibile da una funzione rotta.
 *
 * L'action ora riporta anche QUANTI codici ha scartato, così la modale può
 * dire perché è vuota.
 */

const authMock = vi.fn();
vi.mock('@/auth', () => ({ auth: () => authMock() }));
vi.mock('next/navigation', () => ({ redirect: () => { throw new Error('redirect'); } }));
vi.mock('next/cache', () => ({ revalidatePath: () => {} }));

const promoFindMany = vi.fn();
vi.mock('@pv/db', () => ({
  Prisma: {},
  prisma: {
    crmContact: { findUnique: vi.fn(), update: vi.fn() },
    promoCode: { findMany: (...a: unknown[]) => promoFindMany(...a), findUnique: vi.fn() },
    promoCodeRedemption: { count: vi.fn() },
  },
}));
vi.mock('@/lib/notifiche', () => ({ sendNotification: vi.fn() }));

import { listPromoCodesEmailPartenzaAction } from './actions';

/** Riga come la restituisce la select dell'action. */
function riga(over: Partial<{
  id: string; code: string; amountCent: number; expiresAt: Date | null;
  maxRedemptions: number | null; active: boolean; redemptions: number;
}> = {}) {
  const { redemptions = 0, ...rest } = over;
  return {
    id: 'p1',
    code: 'BENVENUTO',
    amountCent: 20000,
    expiresAt: null,
    maxRedemptions: null,
    active: true,
    _count: { redemptions },
    ...rest,
  };
}

describe('listPromoCodesEmailPartenzaAction', () => {
  beforeEach(() => {
    promoFindMany.mockReset();
    authMock.mockReset();
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN_PIATTAFORMA' } });
  });

  it('ritorna i codici utilizzabili, con importo in euro', async () => {
    promoFindMany.mockResolvedValue([riga({ id: 'p1', code: 'BONUS200', amountCent: 20000 })]);

    const res = await listPromoCodesEmailPartenzaAction();

    expect(res.validi).toEqual([{ id: 'p1', code: 'BONUS200', importoEuro: 200 }]);
    expect(res.scartati).toBe(0);
  });

  it('scaduto, esaurito e disattivato non sono utilizzabili ma vengono CONTATI', async () => {
    promoFindMany.mockResolvedValue([
      riga({ id: 'p1', code: 'SCADUTO', expiresAt: new Date('2020-01-01') }),
      riga({ id: 'p2', code: 'ESAURITO', maxRedemptions: 1, redemptions: 1 }),
      riga({ id: 'p3', code: 'SPENTO', active: false }),
    ]);

    const res = await listPromoCodesEmailPartenzaAction();

    expect(res.validi).toEqual([]);
    // Il numero è ciò che distingue "non ne hai creati" da "ci sono ma non
    // servono a niente": senza, la modale non può spiegare il vuoto.
    expect(res.scartati).toBe(3);
  });

  it('i disattivati arrivano fino al conteggio: la query non li filtra via prima', async () => {
    promoFindMany.mockResolvedValue([riga({ active: false })]);

    await listPromoCodesEmailPartenzaAction();

    // Un `where: { active: true }` li nasconderebbe, e il vuoto tornerebbe muto.
    const where = promoFindMany.mock.calls[0][0]?.where;
    expect(where?.active).toBeUndefined();
  });

  it('nessun codice in piattaforma → liste vuote, nessuno scartato', async () => {
    promoFindMany.mockResolvedValue([]);

    expect(await listPromoCodesEmailPartenzaAction()).toEqual({ validi: [], scartati: 0 });
  });

  it('senza permessi CRM non interroga nemmeno il DB', async () => {
    authMock.mockResolvedValue({ user: { id: 'u2', role: 'ADMIN_AZIENDA' } });

    expect(await listPromoCodesEmailPartenzaAction()).toEqual({ validi: [], scartati: 0 });
    expect(promoFindMany).not.toHaveBeenCalled();
  });
});
