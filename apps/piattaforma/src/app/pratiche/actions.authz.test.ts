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

const { prismaMock, authMock, getSessionContextMock, redirectMock, visuraScadutaMock } = vi.hoisted(() => ({
  prismaMock: {
    pratica: { findUnique: vi.fn(), update: vi.fn() },
    praticaAssegnazione: { updateMany: vi.fn() },
    valutazione: { create: vi.fn() },
    $transaction: vi.fn(async (cb: (t: unknown) => unknown) => cb(prismaMock)),
  },
  authMock: vi.fn(),
  getSessionContextMock: vi.fn(),
  redirectMock: vi.fn((url: string) => {
    throw new Error(`__REDIRECT__:${url}`);
  }),
  visuraScadutaMock: vi.fn(),
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
vi.mock('@/lib/visura/stato', () => ({ isVisuraScadutaCompany: visuraScadutaMock }));
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
  markPraticaProcessataAction,
  markFirmaAvvenutaAction,
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

// Permessi necessari perché i test di SCOPING superino il gate di capability
// e arrivino davvero al controllo di sede/stato che vogliono esercitare.
const PERMESSI_AGENZIA = ['pratiche.view', 'pratiche.processa', 'pratiche.firma', 'pratiche.segnala'];
const PERMESSI_DEALER = ['pratiche.view', 'pratiche.create', 'pratiche.annulla', 'pratiche.valuta'];

function sessione(companyType: 'AGENZIA' | 'DEALER', companyId: string): void {
  authMock.mockResolvedValue({ user: { id: 'u1', companyId, companyType, role: 'OPERATORE' } });
  getSessionContextMock.mockResolvedValue({
    user: { id: 'u1', companyId, companyType, role: 'OPERATORE' },
    companyId,
    companyType,
    isOwner: false,
    accessibleSedi: [{ id: SEDE_MIA, nome: 'Mia', type: companyType }],
    currentSede: { kind: 'ONE', sede: { id: SEDE_MIA, nome: 'Mia', type: companyType } },
    scopeIds: [SEDE_MIA],
    membershipRuoli: {},
    permessi: new Set(companyType === 'AGENZIA' ? PERMESSI_AGENZIA : PERMESSI_DEALER),
    sospensione: { sospeso: false, motivo: null, origine: null },
  });
}

/** Contesto di sessione con i permessi indicati (per i test di capability). */
function ctxConPermessi(
  companyType: 'AGENZIA' | 'DEALER',
  companyId: string,
  permessi: string[],
  overrides: Record<string, unknown> = {},
) {
  return {
    user: { id: 'u1', companyId, companyType, role: 'OPERATORE' },
    companyId,
    companyType,
    isOwner: false,
    accessibleSedi: [{ id: SEDE_MIA, nome: 'Mia', type: companyType }],
    currentSede: { kind: 'ONE', sede: { id: SEDE_MIA, nome: 'Mia', type: companyType } },
    scopeIds: [SEDE_MIA],
    membershipRuoli: { [SEDE_MIA]: 'OPERATORE' },
    permessi: new Set(permessi),
    sospensione: { sospeso: false, motivo: null, origine: null },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.$transaction.mockImplementation(async (cb: (t: unknown) => unknown) => cb(prismaMock));
  prismaMock.pratica.update.mockResolvedValue({});
  prismaMock.praticaAssegnazione.updateMany.mockResolvedValue({});
  prismaMock.valutazione.create.mockResolvedValue({});
  // Default: visura non scaduta (ESENTE/OK/PREAVVISO), mai bloccata. I test
  // dedicati sotto lo sovrascrivono a `true`.
  visuraScadutaMock.mockResolvedValue(false);
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

/**
 * Gate di CAPABILITY (permesso) sulle stesse azioni: precede lo scoping sede
 * (regola d'oro: autenticazione → permesso → scope). Il test più importante di
 * questo task — un operatore con `pratiche.processa` ma senza `pratiche.firma`
 * non deve poter firmare, perché la firma accredita denaro.
 */
describe('processaPraticaFromListaAction — capability', () => {
  it('un operatore senza pratiche.processa non processa la pratica', async () => {
    authMock.mockResolvedValue({
      user: { id: 'u1', companyId: AGENZIA, companyType: 'AGENZIA', role: 'OPERATORE' },
    });
    getSessionContextMock.mockResolvedValue(ctxConPermessi('AGENZIA', AGENZIA, ['pratiche.view']));

    const res = await processaPraticaFromListaAction(PID);

    expect(res).toEqual({ ok: false, error: 'Non hai i permessi per questa azione' });
    expect(prismaMock.pratica.update).not.toHaveBeenCalled();
  });

  it('il wrapper del dettaglio (markPraticaProcessataAction) è coperto dallo stesso gate', async () => {
    authMock.mockResolvedValue({
      user: { id: 'u1', companyId: AGENZIA, companyType: 'AGENZIA', role: 'OPERATORE' },
    });
    getSessionContextMock.mockResolvedValue(ctxConPermessi('AGENZIA', AGENZIA, ['pratiche.view']));

    await expect(markPraticaProcessataAction(PID)).rejects.toThrow(/__REDIRECT__/);

    const url = redirectMock.mock.calls.at(-1)?.[0] as string;
    expect(decodeURIComponent(url)).toContain('Non hai i permessi per questa azione');
    expect(prismaMock.pratica.update).not.toHaveBeenCalled();
  });

  it('con pratiche.processa: supera il gate (arriva al controllo di stato)', async () => {
    sessione('AGENZIA', AGENZIA);
    prismaMock.pratica.findUnique.mockResolvedValue(praticaMiaSede({ stato: 'BOZZA' }));

    const res = await processaPraticaFromListaAction(PID);

    expect(res).toEqual({ ok: false, error: 'Pratica non nello stato ACCETTATA' });
  });
});

describe('firmaFromListaAction — capability', () => {
  it('un operatore con pratiche.processa ma senza pratiche.firma non firma', async () => {
    authMock.mockResolvedValue({
      user: { id: 'u1', companyId: AGENZIA, companyType: 'AGENZIA', role: 'OPERATORE' },
    });
    getSessionContextMock.mockResolvedValue(
      ctxConPermessi('AGENZIA', AGENZIA, ['pratiche.view', 'pratiche.processa']),
    );

    const res = await firmaFromListaAction(PID);

    expect(res).toEqual({ ok: false, error: 'Non hai i permessi per questa azione' });
    expect(prismaMock.pratica.update).not.toHaveBeenCalled();
  });

  it('il wrapper del dettaglio (markFirmaAvvenutaAction) è coperto dallo stesso gate', async () => {
    authMock.mockResolvedValue({
      user: { id: 'u1', companyId: AGENZIA, companyType: 'AGENZIA', role: 'OPERATORE' },
    });
    getSessionContextMock.mockResolvedValue(
      ctxConPermessi('AGENZIA', AGENZIA, ['pratiche.view', 'pratiche.processa']),
    );

    await expect(markFirmaAvvenutaAction(PID)).rejects.toThrow(/__REDIRECT__/);

    const url = redirectMock.mock.calls.at(-1)?.[0] as string;
    expect(decodeURIComponent(url)).toContain('Non hai i permessi per questa azione');
    expect(prismaMock.pratica.update).not.toHaveBeenCalled();
  });

  it('con pratiche.firma: supera il gate (arriva al controllo di stato)', async () => {
    sessione('AGENZIA', AGENZIA);
    prismaMock.pratica.findUnique.mockResolvedValue(
      praticaMiaSede({ stato: 'ACCETTATA', broker: {}, agenziaAssegnata: {} }),
    );

    const res = await firmaFromListaAction(PID);

    expect(res).toEqual({ ok: false, error: 'La pratica deve essere prima processata' });
  });

  it('proprietario: ammesso anche senza permessi espliciti (isOwner bypassa il gate)', async () => {
    authMock.mockResolvedValue({
      user: { id: 'u1', companyId: AGENZIA, companyType: 'AGENZIA', role: 'ADMIN_AZIENDA' },
    });
    getSessionContextMock.mockResolvedValue(
      ctxConPermessi('AGENZIA', AGENZIA, [], { isOwner: true }),
    );
    prismaMock.pratica.findUnique.mockResolvedValue(
      praticaMiaSede({ stato: 'ACCETTATA', broker: {}, agenziaAssegnata: {} }),
    );

    const res = await firmaFromListaAction(PID);

    // Superato il gate: fallisce sullo stato, non sui permessi.
    expect(res).toEqual({ ok: false, error: 'La pratica deve essere prima processata' });
  });
});

describe('annullaPraticaAction — capability', () => {
  it('un broker senza pratiche.annulla non annulla', async () => {
    authMock.mockResolvedValue({
      user: { id: 'u1', companyId: BROKER, companyType: 'DEALER', role: 'OPERATORE' },
    });
    getSessionContextMock.mockResolvedValue(ctxConPermessi('DEALER', BROKER, ['pratiche.view']));

    await expect(annullaPraticaAction(PID)).rejects.toThrow(/__REDIRECT__/);

    const url = redirectMock.mock.calls.at(-1)?.[0] as string;
    expect(decodeURIComponent(url)).toContain('Non hai i permessi per questa azione');
    expect(prismaMock.pratica.update).not.toHaveBeenCalled();
  });
});

describe('submitValutazioneAction — capability', () => {
  const fd = (): FormData => {
    const f = new FormData();
    f.set('praticaId', PID);
    f.set('stelle', '5');
    f.set('note', '');
    return f;
  };

  it('un broker senza pratiche.valuta non valuta', async () => {
    authMock.mockResolvedValue({
      user: { id: 'u1', companyId: BROKER, companyType: 'DEALER', role: 'OPERATORE' },
    });
    getSessionContextMock.mockResolvedValue(ctxConPermessi('DEALER', BROKER, ['pratiche.view']));

    const res = await submitValutazioneAction(fd());

    expect(res).toEqual({ ok: false, error: 'Non hai i permessi per questa azione' });
    expect(prismaMock.valutazione.create).not.toHaveBeenCalled();
  });
});

/**
 * Guard visura scaduta (clausola 8 dei Termini), aggiunto accanto a
 * `isAgenziaBloccata` in `processaPraticaCore` (app/pratiche/actions.ts) e nel
 * ramo AGENZIA di `firmaPraticaCore` (lib/pratiche/firma-engine.ts). SOLO
 * agenzie: qui la sessione è sempre AGENZIA, quindi non serve un test DEALER
 * dedicato — il gate `companyType !== 'AGENZIA'` (verificato leggendo i tre
 * punti) fa già uscire i broker prima di arrivare a questo check.
 */
describe('processaPraticaFromListaAction — guard visura scaduta (clausola 8)', () => {
  it("agenzia con visura scaduta → non può lavorare la pratica (redirect /visura)", async () => {
    sessione('AGENZIA', AGENZIA);
    visuraScadutaMock.mockResolvedValue(true);

    await expect(processaPraticaFromListaAction(PID)).rejects.toThrow(/__REDIRECT__/);

    const url = redirectMock.mock.calls.at(-1)?.[0] as string;
    expect(url).toBe('/visura');
    // Il redirect scatta prima di leggere la pratica: nessuna riga toccata.
    expect(prismaMock.pratica.findUnique).not.toHaveBeenCalled();
  });

  it('agenzia con visura valida → procede (arriva al controllo di stato)', async () => {
    sessione('AGENZIA', AGENZIA);
    visuraScadutaMock.mockResolvedValue(false);
    prismaMock.pratica.findUnique.mockResolvedValue(praticaMiaSede({ stato: 'BOZZA' }));

    const res = await processaPraticaFromListaAction(PID);

    expect(res).toEqual({ ok: false, error: 'Pratica non nello stato ACCETTATA' });
  });
});

describe('firmaFromListaAction — guard visura scaduta (clausola 8)', () => {
  it("agenzia con visura scaduta → non può firmare la pratica (redirect /visura)", async () => {
    sessione('AGENZIA', AGENZIA);
    visuraScadutaMock.mockResolvedValue(true);

    await expect(firmaFromListaAction(PID)).rejects.toThrow(/__REDIRECT__/);

    const url = redirectMock.mock.calls.at(-1)?.[0] as string;
    expect(url).toBe('/visura');
    expect(prismaMock.pratica.findUnique).not.toHaveBeenCalled();
  });

  it('agenzia con visura valida → procede (arriva al controllo di stato)', async () => {
    sessione('AGENZIA', AGENZIA);
    visuraScadutaMock.mockResolvedValue(false);
    prismaMock.pratica.findUnique.mockResolvedValue(
      praticaMiaSede({ stato: 'ACCETTATA', broker: {}, agenziaAssegnata: {} }),
    );

    const res = await firmaFromListaAction(PID);

    expect(res).toEqual({ ok: false, error: 'La pratica deve essere prima processata' });
  });
});
