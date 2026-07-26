import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Distribuzione a raggio-km v2 (Task 7 — wiring submit pratica): il submit
 * deve aprire la distribuzione chiamando SEMPRE `avviaRound1ForPratica`
 * (Task 6, engine v2) — mai uno stato legacy tipo `IN_ATTESA_ROUND_1` scritto
 * a mano dentro l'action. Questo file esercita l'INTERO `submitNuovaPraticaAction`
 * a valle di un submit valido (a differenza di `actions.coords.test.ts`, che
 * verifica solo lo schema zod delle coordinate) per provare la wiring:
 *
 *  1. `avviaRound1ForPratica` viene invocato esattamente una volta con l'id
 *     della pratica appena creata.
 *  2. L'unico `stato` scritto DIRETTAMENTE dall'action è `BOZZA` (alla create):
 *     nessun `prisma.pratica.update` avviene nell'action stessa — la
 *     transizione a `IN_DISTRIBUZIONE`/`raggioCorrenteM` è responsabilità
 *     esclusiva di `avviaRound1ForPratica` (già coperta da tick.test.ts).
 *  3. L'email cliente "AVVIATA" viene sempre inviata dopo `avviaRound1ForPratica`
 *     (che porta sempre a IN_DISTRIBUZIONE — Task 12: rimosso il vecchio ramo
 *     condizionale su uno stato BOZZA che non può più verificarsi qui).
 *  4. Submit senza coordinate continua a fallire la validazione PRIMA di
 *     invocare `avviaRound1ForPratica` (invariato).
 *
 * Tutte le dipendenze pesanti (OCR, gating documentale, pricing, notifiche,
 * sessione/permessi) sono mockate: l'obiettivo è isolare la wiring, non
 * ri-testare l'engine documentale o l'OCR (hanno già test dedicati). Nessuna
 * rete/DB reale: stesso approccio di `actions.authz.test.ts`.
 */

const {
  authMock,
  getSessionContextMock,
  prismaMock,
  redirectMock,
  ocrExtractTextMock,
  getOcrMock,
  storageGetBufferMock,
  getStorageMock,
  avviaRound1ForPraticaMock,
  sendNotificationMock,
  notifyClientiAvanzamentoMock,
  destinatariBrokerMock,
  validaParteMock,
  documentiRichiestiParteMock,
  crossCheckPerVeicoloMock,
  calcolaDocumentiRichiestiMock,
  getTariffarioCorrenteMock,
} = vi.hoisted(() => {
  const prismaMock = {
    pratica: {
      count: vi.fn(async () => 0),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: 'pratica-1',
        ...data,
      })),
      update: vi.fn(),
    },
    atecoAllowedCode: { findMany: vi.fn(async () => []) },
    brokerDichiarazione: { create: vi.fn(async () => ({})) },
    veicolo: {
      create: vi.fn(async ({ data }: { data: { ordine: number } }) => ({
        id: `veicolo-${data.ordine}`,
        ...data,
      })),
    },
    documento: { create: vi.fn(async () => ({ id: 'doc-x' })) },
    venditore: {
      create: vi.fn(async ({ data }: { data: { ordine: number } }) => ({
        id: `venditore-${data.ordine}`,
        ...data,
      })),
    },
    coAcquirente: {
      create: vi.fn(async ({ data }: { data: { ordine: number } }) => ({
        id: `coacq-${data.ordine}`,
        ...data,
      })),
    },
    $transaction: vi.fn(async (cb: (t: unknown) => unknown) => cb(prismaMock)),
  };

  const ocrExtractTextMock = vi.fn(async () => ({ text: 'stub ocr text', confidence: 1 }));

  return {
    authMock: vi.fn(),
    getSessionContextMock: vi.fn(),
    prismaMock,
    redirectMock: vi.fn((url: string) => {
      throw new Error(`__REDIRECT__:${url}`);
    }),
    ocrExtractTextMock,
    getOcrMock: vi.fn(async () => ({ extractText: ocrExtractTextMock })),
    storageGetBufferMock: vi.fn(async () => Buffer.from('stub-bytes')),
    getStorageMock: vi.fn(() => ({ name: 'local' })),
    avviaRound1ForPraticaMock: vi.fn(async (_praticaId: string) => ({
      assegnazioni: 2,
      stato: 'IN_DISTRIBUZIONE',
      newAssegnazioniIds: ['assegnazione-1', 'assegnazione-2'],
    })),
    sendNotificationMock: vi.fn(async () => undefined),
    notifyClientiAvanzamentoMock: vi.fn(async () => undefined),
    destinatariBrokerMock: vi.fn(async () => [
      { email: 'broker@example.com', userId: 'u1', nome: 'Mario Rossi' },
    ]),
    // Gating documentale/OCR fail-closed: mockati a "tutto passa" perché
    // hanno già copertura dedicata altrove — qui contano solo il submit e la
    // wiring verso la distribuzione, non le regole di business dei documenti.
    validaParteMock: vi.fn(() => ({ ok: true, problemi: [] as string[] })),
    documentiRichiestiParteMock: vi.fn(() => ({
      identita: true,
      visura: false,
      permesso: false,
      codiceFiscale: false,
    })),
    crossCheckPerVeicoloMock: vi.fn(() => 'OK' as const),
    calcolaDocumentiRichiestiMock: vi.fn(() => ({
      kind: 'OK' as const,
      documentiRichiesti: [] as never[],
    })),
    getTariffarioCorrenteMock: vi.fn(async () => ({
      SEMPLICE: { feeAgenziaCent: 7500, creditoBrokerCent: 2500, affiliazioneCent: 1000 },
      MINIVOLTURA: { feeAgenziaCent: 1500, creditoBrokerCent: 0, affiliazioneCent: 500 },
    })),
  };
});

vi.mock('@pv/db', () => ({ prisma: prismaMock, Prisma: {} }));
vi.mock('@/auth', () => ({ auth: authMock }));
vi.mock('@/lib/auth/session-context', async (orig) => {
  const actual = (await orig()) as object;
  return { ...actual, getSessionContext: getSessionContextMock };
});
vi.mock('next/navigation', () => ({ redirect: redirectMock }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/headers', () => ({ headers: vi.fn(async () => new Headers()) }));

vi.mock('@/lib/providers/ocr', () => ({ getOcr: getOcrMock }));
vi.mock('@/lib/providers/storage', () => ({
  getStorage: getStorageMock,
  storageGetBuffer: storageGetBufferMock,
}));
vi.mock('@/lib/kyc/visura-parser', () => ({
  extractVisura: vi.fn(async () => ({})),
}));

// Il consumer del Task 6 (engine v2): la wiring del submit è esattamente
// "chiama questa funzione con l'id pratica", niente di più. Mockata per
// isolare la wiring dall'engine (già testato in tick.test.ts).
vi.mock('@/lib/distribuzione', () => ({ avviaRound1ForPratica: avviaRound1ForPraticaMock }));

vi.mock('@/lib/notifiche', () => ({
  sendNotification: sendNotificationMock,
  notifyClientiAvanzamento: notifyClientiAvanzamentoMock,
}));
vi.mock('@/lib/notifiche/pratica', () => ({ destinatariBroker: destinatariBrokerMock }));

// Gating documentale/cross-check/pricing: bypassati (vedi commento sopra sui
// mock hoisted) così il submit raggiunge la scrittura DB senza dover
// ricostruire l'intero motore OCR/gating in questo test di wiring.
vi.mock('@/lib/kyc/parte-docs', async (orig) => {
  const actual = (await orig()) as object;
  return { ...actual, validaParte: validaParteMock, documentiRichiestiParte: documentiRichiestiParteMock };
});
vi.mock('./venditori-per-veicolo', () => ({ crossCheckPerVeicolo: crossCheckPerVeicoloMock }));
vi.mock('@/lib/documenti/engine', async (orig) => {
  const actual = (await orig()) as object;
  return { ...actual, calcolaDocumentiRichiesti: calcolaDocumentiRichiestiMock };
});
vi.mock('@/lib/tariffario', () => ({ getTariffarioCorrente: getTariffarioCorrenteMock }));
// Clausola 3: gate della riaccettazione tariffaria, nessuna pendente di default.
vi.mock('@/lib/tariffe/riaccettazione', () => ({
  getRiaccettazionePendente: vi.fn(() => Promise.resolve(null)),
  ERRORE_RIACCETTAZIONE_PENDENTE: 'riaccettazione pendente',
}));

import { submitNuovaPraticaAction } from './actions';

const DEALER = 'dealer-1';
const SEDE = { id: 'sede-1', nome: 'Sede test', type: 'DEALER' as const, citta: 'Milano' };

function sessionCtx() {
  return {
    user: { id: 'u1', companyId: DEALER, companyType: 'DEALER', role: 'OPERATORE' },
    companyId: DEALER,
    companyType: 'DEALER' as const,
    isOwner: false,
    accessibleSedi: [SEDE],
    currentSede: { kind: 'ONE' as const, sede: SEDE },
    scopeIds: [SEDE.id],
    membershipRuoli: {},
    permessi: new Set(['pratiche.create']),
    sospensione: { sospeso: false, motivo: null, origine: null },
  };
}

/** File di upload valido (già su Blob): forma attesa dallo slot `blobRefs`. */
const ref = (key: string) => ({
  key,
  name: `${key}.pdf`,
  size: 1024,
  type: 'application/pdf',
});

/**
 * FormData minima e valida per una pratica SEMPLICE, 1 veicolo, 1 venditore
 * privato italiano (CIE, niente CF/visura/permesso da allegare), acquirente
 * privato italiano. Coordinate valide di default — `overrides` permette di
 * costruire il caso "senza coordinate" per il test di regressione.
 */
function buildValidFormData(overrides: Record<string, string | undefined> = {}): FormData {
  const fd = new FormData();
  const fields: Record<string, string | undefined> = {
    tipo: 'SEMPLICE',
    numeroVeicoli: '1',
    veicoli: JSON.stringify([
      {
        tipoDocumento: 'LIBRETTO',
        targa: 'AB123CD',
        telaio: 'WBA12345678901234',
        proprietarioAttuale: 'Mario Rossi',
        preImm2015: false,
        flagComodatoDuso: false,
        flagDelegaVendita: false,
        prezzoVenditaCent: 500000,
      },
    ]),
    venditori: JSON.stringify([
      {
        ordine: 1,
        veicoloOrdine: 1,
        isPG: false,
        tipoSoggetto: 'PRIVATO_ITALIANO',
        ciTipo: 'ELETTRONICA',
        nome: 'Mario',
        cognome: 'Rossi',
        cf: 'RSSMRA80A01H501U',
        telefono: '3331234567',
        email: 'venditore@example.com',
        docId: 'CI',
      },
    ]),
    coAcquirenti: '[]',
    acquirenteIsPG: 'false',
    acquirenteTelefono: '3339876543',
    acquirenteEmail: 'acquirente@example.com',
    acquirenteDocumentoIdentita: 'CI',
    acquirenteTipoSoggetto: 'PRIVATO_ITALIANO',
    acquirenteCiTipo: 'ELETTRONICA',
    comune: 'Milano',
    provincia: 'MI',
    lat: '45.4642',
    lng: '9.19',
    dichiarazioneAccettata: 'true',
    dichiarazionePopupVersion: 'v1',
    blobRefs: JSON.stringify({
      LIBRETTO_1_FRONTE: ref('LIBRETTO_1_FRONTE'),
      LIBRETTO_1_RETRO: ref('LIBRETTO_1_RETRO'),
      VEND1_ID_FRONTE: ref('VEND1_ID_FRONTE'),
      VEND1_ID_RETRO: ref('VEND1_ID_RETRO'),
      ACQ_ID_FRONTE: ref('ACQ_ID_FRONTE'),
      ACQ_ID_RETRO: ref('ACQ_ID_RETRO'),
    }),
    ...overrides,
  };
  for (const [k, v] of Object.entries(fields)) {
    if (v !== undefined) fd.set(k, v);
  }
  return fd;
}

beforeEach(() => {
  vi.clearAllMocks();
  authMock.mockResolvedValue({
    user: { id: 'u1', companyId: DEALER, companyType: 'DEALER', role: 'OPERATORE' },
  });
  getSessionContextMock.mockResolvedValue(sessionCtx());
  ocrExtractTextMock.mockResolvedValue({ text: 'stub ocr text', confidence: 1 });
  storageGetBufferMock.mockResolvedValue(Buffer.from('stub-bytes'));
  getStorageMock.mockReturnValue({ name: 'local' });
  prismaMock.$transaction.mockImplementation(async (cb: (t: unknown) => unknown) => cb(prismaMock));
  avviaRound1ForPraticaMock.mockResolvedValue({
    assegnazioni: 2,
    stato: 'IN_DISTRIBUZIONE',
    newAssegnazioniIds: ['assegnazione-1', 'assegnazione-2'],
  });
  validaParteMock.mockReturnValue({ ok: true, problemi: [] });
  documentiRichiestiParteMock.mockReturnValue({
    identita: true,
    visura: false,
    permesso: false,
    codiceFiscale: false,
  });
  crossCheckPerVeicoloMock.mockReturnValue('OK');
  calcolaDocumentiRichiestiMock.mockReturnValue({ kind: 'OK', documentiRichiesti: [] });
});

describe('submitNuovaPraticaAction — wiring distribuzione v2 (Task 7)', () => {
  it('submit valido: chiama avviaRound1ForPratica con l\'id pratica, niente scrittura di stato diretta', async () => {
    const res = await submitNuovaPraticaAction(buildValidFormData());

    expect(res).toEqual({ ok: true, id: 'pratica-1' });

    // La wiring: il submit delega TUTTA l'apertura della distribuzione a
    // avviaRound1ForPratica (Task 6) — chiamato una volta con l'id appena creato.
    expect(avviaRound1ForPraticaMock).toHaveBeenCalledTimes(1);
    expect(avviaRound1ForPraticaMock).toHaveBeenCalledWith('pratica-1');

    // Nessuno stato legacy scritto a mano: l'unica scrittura di `stato` è la
    // create iniziale in BOZZA; `IN_DISTRIBUZIONE`/`raggioCorrenteM` sono
    // scritti SOLO dentro avviaRound1ForPratica (mockato qui, testato in
    // tick.test.ts) — il submit stesso non deve mai chiamare pratica.update.
    expect(prismaMock.pratica.update).not.toHaveBeenCalled();
    expect(prismaMock.pratica.create).toHaveBeenCalledTimes(1);
    const createArgs = prismaMock.pratica.create.mock.calls[0]![0] as {
      data: Record<string, unknown>;
    };
    expect(createArgs.data.stato).toBe('BOZZA');

    // Il ritorno di avviaRound1ForPratica guida le notifiche a valle: stato
    // IN_DISTRIBUZIONE (non BOZZA) → email cliente "AVVIATA" inviata.
    expect(notifyClientiAvanzamentoMock).toHaveBeenCalledWith('pratica-1', 'AVVIATA');
    expect(destinatariBrokerMock).toHaveBeenCalledWith('pratica-1');
    expect(sendNotificationMock).toHaveBeenCalled();

    // Nessun redirect di validazione: il submit valido arriva in fondo.
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it('submit senza coordinate: redirect di validazione, avviaRound1ForPratica MAI invocato', async () => {
    const fd = buildValidFormData({ lat: undefined, lng: undefined });

    await expect(submitNuovaPraticaAction(fd)).rejects.toThrow(/__REDIRECT__/);

    expect(avviaRound1ForPraticaMock).not.toHaveBeenCalled();
    expect(prismaMock.pratica.create).not.toHaveBeenCalled();
  });
});
