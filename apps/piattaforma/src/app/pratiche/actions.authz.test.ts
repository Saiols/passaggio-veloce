import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Gate di scoping per sede sulle azioni di SCRITTURA della pratica.
 *
 * La lettura è già scopata (lista, dettaglio, download): un utente della sede A
 * non vede la pratica della sede B. Ma le action controllavano solo la company,
 * quindi chi conosceva l'UUID poteva comunque mutare la pratica di un'altra
 * filiale — marcarla firmata, accreditare quel wallet, generare un FeeAddebito
 * a carico della madre.
 *
 * Strategia dei test: il gate sede sta PRIMA del controllo di stato. Passando
 * una pratica in uno stato non lavorabile distinguiamo i due casi dal messaggio:
 *  - "…tua sede"     ⇒ ha respinto il gate sede (deny corretto)
 *  - errore di stato ⇒ il gate sede è PASSATO (allow corretto)
 * Così l'allow-path è provato senza eseguire accrediti, fatture e notifiche.
 */

const { prismaMock, authMock, getSessionContextMock, redirectMock } = vi.hoisted(() => ({
  prismaMock: {
    pratica: { findUnique: vi.fn(), update: vi.fn(), create: vi.fn() },
    praticaAssegnazione: { updateMany: vi.fn() },
    valutazione: { create: vi.fn() },
    $transaction: vi.fn(async (cb: (t: unknown) => unknown) => cb(prismaMock)),
  },
  authMock: vi.fn(),
  getSessionContextMock: vi.fn(),
  redirectMock: vi.fn((url: string) => {
    throw new Error(`__REDIRECT__:${url}`);
  }),
}));

vi.mock('@pv/db', () => ({ prisma: prismaMock }));
vi.mock('@/auth', () => ({ auth: authMock }));
vi.mock('@/lib/auth/session-context', async (orig) => {
  const actual = (await orig()) as object;
  return { ...actual, getSessionContext: getSessionContextMock };
});
vi.mock('next/navigation', () => ({ redirect: redirectMock }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

// Effetti collaterali: mai raggiunti nei test di deny; neutralizzati per non
// dipendere da wallet, fatture, email e CRM.
vi.mock('@/lib/fee/blocco', () => ({ isAgenziaBloccata: vi.fn(() => Promise.resolve(false)) }));
vi.mock('@/lib/notifiche', () => ({
  sendNotification: vi.fn(() => Promise.resolve()),
  notifyClientiAvanzamento: vi.fn(() => Promise.resolve()),
}));
vi.mock('@/lib/affiliazione/accredit', () => ({
  accreditCommissioniAffiliazione: vi.fn(() => Promise.resolve([])),
}));
vi.mock('@/lib/affiliazione/notifications', () => ({
  notifyReferralFirstPratica: vi.fn(() => Promise.resolve()),
  notifyPayoutThresholdCrossed: vi.fn(() => Promise.resolve()),
}));
vi.mock('@/lib/crm/sync', () => ({ onPraticaFirmata: vi.fn(() => Promise.resolve()) }));
vi.mock('@/lib/fatturazione/engine', () => ({ createFatturaPv: vi.fn(() => Promise.resolve(null)) }));
vi.mock('@/lib/fatturazione/documento-pdf', () => ({
  fatturaPvAttachment: vi.fn(() => Promise.resolve(null)),
}));
vi.mock('@/lib/wallet/auto-payout', () => ({
  autoPayoutBrokerDopoFirma: vi.fn(() => Promise.resolve()),
}));
vi.mock('@/lib/eventi/emit', () => ({ emitEventoPratica: vi.fn(() => Promise.resolve()) }));
vi.mock('@/lib/eventi/pratica-eventi', () => ({
  eventoPraticaLavorata: vi.fn(() => ({})),
  eventoPraticaFirmata: vi.fn(() => ({})),
  eventoPraticaAnnullata: vi.fn(() => ({})),
}));

import {
  processaPraticaFromListaAction,
  firmaFromListaAction,
  annullaPraticaAction,
  submitValutazioneAction,
} from './actions';

// UUID valido: lo schema Zod di submitValutazioneAction esige un uuid.
const PID = '11111111-1111-4111-8111-111111111111';
const AGENZIA = 'ag-1';
const BROKER = 'br-1';
const SEDE_MIA = 'sede-mia';
const SEDE_ALTRA = 'sede-altra';

/** Pratica assegnata alla sede ALTRA (della stessa azienda madre). */
const praticaAltraSede = (over: Record<string, unknown> = {}) => ({
  id: PID,
  brokerId: BROKER,
  brokerSedeId: SEDE_ALTRA,
  agenziaAssegnataId: AGENZIA,
  agenziaSedeId: SEDE_ALTRA,
  stato: 'ACCETTATA',
  feeAgenziaCent: 0,
  creditoBrokerCent: 0,
  ...over,
});

const praticaMiaSede = (over: Record<string, unknown> = {}) =>
  praticaAltraSede({ brokerSedeId: SEDE_MIA, agenziaSedeId: SEDE_MIA, ...over });

function sessione(companyType: 'AGENZIA' | 'DEALER', companyId: string): void {
  authMock.mockResolvedValue({ user: { id: 'u1', companyId, companyType, role: 'OPERATORE' } });
  getSessionContextMock.mockResolvedValue({
    user: { id: 'u1', companyId, companyType, role: 'OPERATORE' },
    companyId,
    isOwner: false,
    accessibleSedi: [{ id: SEDE_MIA, nome: 'Mia', type: companyType }],
    currentSede: { kind: 'ONE', sede: { id: SEDE_MIA, nome: 'Mia', type: companyType } },
    scopeIds: [SEDE_MIA],
    membershipRuoli: {},
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.$transaction.mockImplementation(async (cb: (t: unknown) => unknown) => cb(prismaMock));
  prismaMock.pratica.update.mockResolvedValue({});
  prismaMock.praticaAssegnazione.updateMany.mockResolvedValue({});
  prismaMock.valutazione.create.mockResolvedValue({});
});

describe('processaPraticaFromListaAction — scoping sede', () => {
  it('rifiuta una pratica di un\'altra sede della stessa agenzia', async () => {
    sessione('AGENZIA', AGENZIA);
    prismaMock.pratica.findUnique.mockResolvedValue(praticaAltraSede());

    const res = await processaPraticaFromListaAction(PID);

    expect(res).toEqual({ ok: false, error: 'Pratica non assegnata alla tua sede' });
    expect(prismaMock.pratica.update).not.toHaveBeenCalled();
  });

  it('accetta la pratica della propria sede (arriva al controllo di stato)', async () => {
    sessione('AGENZIA', AGENZIA);
    prismaMock.pratica.findUnique.mockResolvedValue(praticaMiaSede({ stato: 'BOZZA' }));

    const res = await processaPraticaFromListaAction(PID);

    // Superato il gate sede: fallisce sullo stato, non sulla sede.
    expect(res).toEqual({ ok: false, error: 'Pratica non nello stato ACCETTATA' });
  });

  it('rifiuta una pratica di un\'altra agenzia', async () => {
    sessione('AGENZIA', AGENZIA);
    prismaMock.pratica.findUnique.mockResolvedValue(
      praticaMiaSede({ agenziaAssegnataId: 'ag-estranea' }),
    );

    const res = await processaPraticaFromListaAction(PID);

    expect(res).toEqual({ ok: false, error: 'Pratica non assegnata a questa agenzia' });
    expect(prismaMock.pratica.update).not.toHaveBeenCalled();
  });
});

describe('firmaFromListaAction — scoping sede', () => {
  it('rifiuta una pratica di un\'altra sede (nessun accredito, nessun addebito)', async () => {
    sessione('AGENZIA', AGENZIA);
    prismaMock.pratica.findUnique.mockResolvedValue(
      praticaAltraSede({ stato: 'PROCESSATA', broker: {}, agenziaAssegnata: {} }),
    );

    const res = await firmaFromListaAction(PID);

    expect(res).toEqual({ ok: false, error: 'Pratica non assegnata alla tua sede' });
    expect(prismaMock.pratica.update).not.toHaveBeenCalled();
  });

  it('accetta la pratica della propria sede (arriva al controllo di stato)', async () => {
    sessione('AGENZIA', AGENZIA);
    prismaMock.pratica.findUnique.mockResolvedValue(
      praticaMiaSede({ stato: 'ACCETTATA', broker: {}, agenziaAssegnata: {} }),
    );

    const res = await firmaFromListaAction(PID);

    expect(res).toEqual({ ok: false, error: 'La pratica deve essere prima processata' });
  });
});

describe('annullaPraticaAction — scoping sede', () => {
  it('rifiuta una pratica di un\'altra sede del broker', async () => {
    sessione('DEALER', BROKER);
    prismaMock.pratica.findUnique.mockResolvedValue(praticaAltraSede());

    await expect(annullaPraticaAction(PID)).rejects.toThrow(/__REDIRECT__/);

    const url = redirectMock.mock.calls.at(-1)?.[0] as string;
    expect(decodeURIComponent(url)).toContain('Pratica non assegnata alla tua sede');
    expect(prismaMock.pratica.update).not.toHaveBeenCalled();
  });

  it('accetta la pratica della propria sede (arriva al controllo di stato)', async () => {
    sessione('DEALER', BROKER);
    prismaMock.pratica.findUnique.mockResolvedValue(praticaMiaSede({ stato: 'FIRMATA' }));

    await expect(annullaPraticaAction(PID)).rejects.toThrow(/__REDIRECT__/);

    const url = redirectMock.mock.calls.at(-1)?.[0] as string;
    expect(decodeURIComponent(url)).toContain('già firmata');
  });
});

describe('submitValutazioneAction — scoping sede', () => {
  const fd = (): FormData => {
    const f = new FormData();
    f.set('praticaId', PID);
    f.set('stelle', '5');
    f.set('note', '');
    return f;
  };

  it('rifiuta la valutazione di una pratica di un\'altra sede del broker', async () => {
    sessione('DEALER', BROKER);
    prismaMock.pratica.findUnique.mockResolvedValue(
      praticaAltraSede({ stato: 'FIRMATA', valutazione: null }),
    );

    const res = await submitValutazioneAction(fd());

    expect(res).toEqual({ ok: false, error: 'Pratica non assegnata alla tua sede' });
    expect(prismaMock.valutazione.create).not.toHaveBeenCalled();
  });

  it('accetta la pratica della propria sede (arriva al controllo di stato)', async () => {
    sessione('DEALER', BROKER);
    prismaMock.pratica.findUnique.mockResolvedValue(
      praticaMiaSede({ stato: 'ACCETTATA', valutazione: null }),
    );

    const res = await submitValutazioneAction(fd());

    expect(res).toEqual({ ok: false, error: 'Puoi valutare solo pratiche firmate' });
  });
});
