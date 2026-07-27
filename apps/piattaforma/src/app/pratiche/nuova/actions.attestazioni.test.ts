import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Attestazioni pre-invio (spec 2026-07-27, Task 4): il submit deve validare
 * `dichiarazionePopupVersion` contro il registro (`attestazioniPerVersione`),
 * leggere i testi persistiti DAL REGISTRO server-side (mai dal payload
 * client) e scrivere `BrokerDichiarazione` DENTRO la stessa transazione della
 * pratica — prima era un log best-effort in un catch vuoto: se falliva, la
 * pratica partiva comunque e la prova non esisteva, senza che nessuno se ne
 * accorgesse.
 *
 * Setup copiato da `actions.submit-distribuzione.test.ts` (mocka già
 * sessione, permessi, OCR, gating documentale, pricing, notifiche e
 * distribuzione): qui interessa solo il comportamento sulle attestazioni, non
 * ri-testare la wiring della distribuzione (già coperta altrove).
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
    brokerDichiarazione: {
      // Tipizzato con `data` (invece di `vi.fn(async () => ({}))`) perché i
      // test qui sotto leggono `mock.calls[0]![0].data` per ispezionare cosa
      // viene scritto — a differenza degli altri file di test di questa
      // cartella, che si limitano a verificare SE è stato chiamato.
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ ...data })),
    },
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
    // hanno già copertura dedicata altrove — qui contano solo il submit e le
    // attestazioni, non le regole di business dei documenti.
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
// A differenza del modello copiato: qui l'IP conta (ultimo test della suite),
// quindi l'header arriva valorizzato invece di un `new Headers()` vuoto.
vi.mock('next/headers', () => ({
  headers: vi.fn(
    async () =>
      new Headers({ 'x-forwarded-for': '93.45.201.77', 'user-agent': 'vitest' }),
  ),
}));

vi.mock('@/lib/providers/ocr', () => ({ getOcr: getOcrMock }));
vi.mock('@/lib/providers/storage', () => ({
  getStorage: getStorageMock,
  storageGetBuffer: storageGetBufferMock,
}));
vi.mock('@/lib/kyc/visura-parser', () => ({
  extractVisura: vi.fn(async () => ({})),
}));

vi.mock('@/lib/distribuzione', () => ({ avviaRound1ForPratica: avviaRound1ForPraticaMock }));

vi.mock('@/lib/notifiche', () => ({
  sendNotification: sendNotificationMock,
  notifyClientiAvanzamento: notifyClientiAvanzamentoMock,
}));
vi.mock('@/lib/notifiche/pratica', () => ({ destinatariBroker: destinatariBrokerMock }));

// Gating documentale/cross-check/pricing: bypassati (vedi commento sopra sui
// mock hoisted) così il submit raggiunge la scrittura DB senza dover
// ricostruire l'intero motore OCR/gating in questo file.
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
 * privato italiano. Entrambe le attestazioni accettate con la versione
 * corrente del registro — `overrides` permette di costruire i casi di rifiuto.
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
    attestazioneTerziAccettata: 'true',
    dichiarazionePopupVersion: 'v4.0',
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

import { attestazioniPerVersione } from '@/lib/legal/attestazioni';

async function submit(fd: FormData): Promise<string | null> {
  const { submitNuovaPraticaAction } = await import('./actions');
  try {
    await submitNuovaPraticaAction(fd);
    return null;
  } catch (e) {
    const m = /^__REDIRECT__:(.*)$/.exec((e as Error).message);
    if (m) return m[1]!;
    throw e;
  }
}

describe('attestazioni pre-invio', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('senza la spunta sui terzi la pratica non parte', async () => {
    const url = await submit(buildValidFormData({ attestazioneTerziAccettata: 'false' }));
    expect(url).toContain('error=');
    expect(prismaMock.pratica.create).not.toHaveBeenCalled();
  });

  it('senza la spunta di responsabilita la pratica non parte', async () => {
    const url = await submit(buildValidFormData({ dichiarazioneAccettata: 'false' }));
    expect(url).toContain('error=');
    expect(prismaMock.pratica.create).not.toHaveBeenCalled();
  });

  // Registrare un'attestazione di cui non conosciamo il testo non e' una prova:
  // meglio rifiutare l'invio e far ricaricare la pagina.
  it('una versione fuori registro viene rifiutata', async () => {
    const url = await submit(buildValidFormData({ dichiarazionePopupVersion: 'v9.9' }));
    expect(url).toContain('error=');
    expect(prismaMock.pratica.create).not.toHaveBeenCalled();
  });

  it('persiste i testi del registro, la versione e il numero di clausola', async () => {
    await submit(buildValidFormData());
    expect(prismaMock.brokerDichiarazione.create).toHaveBeenCalledTimes(1);
    const { data } = prismaMock.brokerDichiarazione.create.mock.calls[0]![0];
    expect(data.popupVersion).toBe('v4.0');
    expect(data.clausolaTerzi).toBe(23);
    expect(data.testoAttestazioni).toEqual(
      attestazioniPerVersione('v4.0')!.map((a) => ({ id: a.id, testo: a.testo })),
    );
  });

  // Il testo e' merce del server. Un payload manomesso non deve poter scrivere
  // nel record una dichiarazione diversa da quella resa a schermo.
  it('ignora un testo iniettato dal client', async () => {
    await submit(buildValidFormData({ testoAttestazioni: '[{"id":"TERZI","testo":"nulla"}]' }));
    const { data } = prismaMock.brokerDichiarazione.create.mock.calls[0]![0];
    expect(JSON.stringify(data.testoAttestazioni)).not.toContain('nulla');
  });

  // IL test della release: prima era un log best-effort in un catch vuoto, e
  // una pratica poteva partire senza la sua prova senza che nessuno lo sapesse.
  it('se la scrittura della prova fallisce, la pratica non esiste', async () => {
    prismaMock.brokerDichiarazione.create.mockRejectedValueOnce(new Error('db down'));
    await expect(submit(buildValidFormData())).rejects.toThrow('db down');
    expect(avviaRound1ForPraticaMock).not.toHaveBeenCalled();
  });

  it("l'IP registrato resta anonimizzato a 3 ottetti", async () => {
    await submit(buildValidFormData());
    const { data } = prismaMock.brokerDichiarazione.create.mock.calls[0]![0];
    expect(data.ip).toMatch(/\.x$/);
  });
});
