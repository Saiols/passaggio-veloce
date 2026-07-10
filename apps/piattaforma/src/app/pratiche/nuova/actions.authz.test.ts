import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Gate di capability (`pratiche.create`) sulle sette server action di
 * creazione pratica: le sei OCR (extractLibrettoAction, extractFoglioComplementareAction,
 * extractIdentitaAction, extractVisuraAction, extractPermessoAction,
 * extractCodiceFiscaleAction) passano dall'helper condiviso `gateCreazione()`;
 * `submitNuovaPraticaAction` chiama `requirePermesso('pratiche.create')`
 * direttamente (stesso permesso, percorso diverso).
 *
 * Il punto di questi test NON è "il gate rifiuta" in astratto: è che, nel caso
 * di rifiuto, il provider OCR (Document AI, a pagamento per estrazione) non
 * viene MAI invocato. Per questo i casi "senza permesso" passano file di
 * upload validi (dimensione/MIME OK): se il gate venisse tolto o rifattorizzato
 * in modo da non bloccare più nulla, il codice proseguirebbe fino a chiamare
 * l'OCR — ed è esattamente questo che l'asserzione su `ocrExtractTextMock`
 * intercetta. Con file invalidi il test "morderebbe" solo sul messaggio di
 * errore, non sulla spesa reale che il gate è nato per evitare.
 *
 * Il caso "con permesso" non deve arrivare in fondo all'action: basta che
 * l'errore NON sia quello di permesso. Per renderlo deterministico (invece di
 * dipendere dal parsing reale del testo OCR) il provider OCR è configurato per
 * fallire sempre con un messaggio non transiente: ogni action, superato il
 * gate, arriva quindi al proprio messaggio di errore OCR — diverso, stabile,
 * e verificabile — mentre `ocrExtractTextMock` risulta comunque invocato (prova
 * che il gate è stato superato).
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
} = vi.hoisted(() => {
  const prismaMock = {
    pratica: { count: vi.fn(), create: vi.fn() },
    atecoAllowedCode: { findMany: vi.fn(() => Promise.resolve([])) },
    brokerDichiarazione: { create: vi.fn() },
    veicolo: { create: vi.fn() },
    documento: { create: vi.fn() },
    venditore: { create: vi.fn() },
    coAcquirente: { create: vi.fn() },
    $transaction: vi.fn(async (cb: (t: unknown) => unknown) => cb(prismaMock)),
  };

  const ocrExtractTextMock = vi.fn();

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

// Il provider OCR è il cuore del rilievo: ogni chiamata reale costa
// un'estrazione Document AI. Mockato qui, a livello di modulo, così TUTTE le
// action (che lo importano ciascuna col proprio `getOcr()`) condividono lo
// stesso mock osservabile dai test.
vi.mock('@/lib/providers/ocr', () => ({ getOcr: getOcrMock }));

// Accesso ai file: le action leggono i byte da Blob/local storage via
// storageGetBuffer. Mockato per non toccare disco/rete e per restare
// deterministico.
vi.mock('@/lib/providers/storage', () => ({
  getStorage: getStorageMock,
  storageGetBuffer: storageGetBufferMock,
}));

// La visura NON passa da `getOcr()` dentro l'action (passa dal parser
// dedicato lib/kyc/visura-parser, che al suo interno richiama `getOcr()` come
// fallback per i PDF scansionati). Mockato qui per instradare comunque la
// verifica sullo stesso `ocrExtractTextMock` condiviso, con la stessa
// controprova "non invocato senza permesso".
vi.mock('@/lib/kyc/visura-parser', () => ({
  extractVisura: vi.fn(async (input: unknown) => {
    const ocr = await getOcrMock();
    await ocr.extractText(input);
    return {};
  }),
}));

import {
  extractLibrettoAction,
  extractFoglioComplementareAction,
  extractIdentitaAction,
  extractVisuraAction,
  extractPermessoAction,
  extractCodiceFiscaleAction,
  submitNuovaPraticaAction,
} from './actions';

const DEALER = 'dealer-1';
const PERMESSO_NEGATO = 'Non hai i permessi per questa azione';

/** File di upload valido (size/MIME OK): così un gate rimosso non si ferma
 * sulla validazione del file, ma proseguirebbe fino all'OCR. */
const validRef = (key: string) => ({
  key,
  name: `${key}.pdf`,
  size: 1024,
  type: 'application/pdf',
});

function ctxBase(permessi: string[]) {
  return {
    user: { id: 'u1', companyId: DEALER, companyType: 'DEALER', role: 'OPERATORE' },
    companyId: DEALER,
    companyType: 'DEALER' as const,
    isOwner: false,
    accessibleSedi: [],
    currentSede: null,
    scopeIds: [],
    membershipRuoli: {},
    permessi: new Set(permessi),
  };
}

const ctxSenzaPermesso = () => ctxBase(['pratiche.view']); // ha altri permessi, non pratiche.create
const ctxConPermesso = () => ctxBase(['pratiche.view', 'pratiche.create']);

beforeEach(() => {
  vi.clearAllMocks();
  authMock.mockResolvedValue({
    user: { id: 'u1', companyId: DEALER, companyType: 'DEALER', role: 'OPERATORE' },
  });
  // OCR sempre fallito con un messaggio NON transiente (niente retry): rende
  // deterministico il messaggio di errore di ogni action una volta superato
  // il gate, e prova comunque che l'OCR è stato invocato.
  ocrExtractTextMock.mockRejectedValue(new Error('ocr simulato: non deve riuscire in questo test'));
  storageGetBufferMock.mockResolvedValue(Buffer.from('stub-bytes'));
  getStorageMock.mockReturnValue({ name: 'local' });
  prismaMock.$transaction.mockImplementation(async (cb: (t: unknown) => unknown) => cb(prismaMock));
});

describe('extractLibrettoAction — capability', () => {
  it('senza pratiche.create rifiuta e non invoca Document AI', async () => {
    getSessionContextMock.mockResolvedValue(ctxSenzaPermesso());
    const res = await extractLibrettoAction(validRef('fronte'), validRef('retro'));
    expect(res).toEqual({ ok: false, error: PERMESSO_NEGATO });
    expect(ocrExtractTextMock).not.toHaveBeenCalled();
  });

  it('con pratiche.create supera il gate (Document AI viene invocato)', async () => {
    getSessionContextMock.mockResolvedValue(ctxConPermesso());
    const res = await extractLibrettoAction(validRef('fronte'), validRef('retro'));
    expect(res).toEqual({
      ok: false,
      error: 'OCR non riuscito sul documento. Compila manualmente i campi del veicolo.',
    });
    expect(ocrExtractTextMock).toHaveBeenCalled();
  });
});

describe('extractFoglioComplementareAction — capability', () => {
  it('senza pratiche.create rifiuta e non invoca Document AI', async () => {
    getSessionContextMock.mockResolvedValue(ctxSenzaPermesso());
    const res = await extractFoglioComplementareAction(validRef('foglio'));
    expect(res).toEqual({ ok: false, error: PERMESSO_NEGATO });
    expect(ocrExtractTextMock).not.toHaveBeenCalled();
  });

  it('con pratiche.create supera il gate (Document AI viene invocato)', async () => {
    getSessionContextMock.mockResolvedValue(ctxConPermesso());
    const res = await extractFoglioComplementareAction(validRef('foglio'));
    expect(res).toEqual({
      ok: false,
      error: 'OCR non riuscito sul foglio complementare. Compila manualmente i campi del veicolo.',
    });
    expect(ocrExtractTextMock).toHaveBeenCalled();
  });
});

describe('extractIdentitaAction — capability', () => {
  it('senza pratiche.create rifiuta e non invoca Document AI', async () => {
    getSessionContextMock.mockResolvedValue(ctxSenzaPermesso());
    const res = await extractIdentitaAction(validRef('ci'), 'CI');
    expect(res).toEqual({ ok: false, error: PERMESSO_NEGATO });
    expect(ocrExtractTextMock).not.toHaveBeenCalled();
  });

  it('con pratiche.create supera il gate (Document AI viene invocato)', async () => {
    getSessionContextMock.mockResolvedValue(ctxConPermesso());
    const res = await extractIdentitaAction(validRef('ci'), 'CI');
    expect(res).toEqual({
      ok: false,
      error: "OCR non riuscito sul documento. Compila manualmente i campi della parte.",
    });
    expect(ocrExtractTextMock).toHaveBeenCalled();
  });
});

describe('extractVisuraAction — capability', () => {
  it('senza pratiche.create rifiuta e non invoca Document AI', async () => {
    getSessionContextMock.mockResolvedValue(ctxSenzaPermesso());
    const res = await extractVisuraAction(validRef('visura'));
    expect(res).toEqual({ ok: false, error: PERMESSO_NEGATO });
    expect(ocrExtractTextMock).not.toHaveBeenCalled();
  });

  it('con pratiche.create supera il gate (Document AI viene invocato)', async () => {
    getSessionContextMock.mockResolvedValue(ctxConPermesso());
    const res = await extractVisuraAction(validRef('visura'));
    expect(res).toEqual({
      ok: false,
      error: 'OCR non riuscito sulla visura. Ricarica un file leggibile.',
    });
    expect(ocrExtractTextMock).toHaveBeenCalled();
  });
});

describe('extractPermessoAction — capability', () => {
  it('senza pratiche.create rifiuta e non invoca Document AI', async () => {
    getSessionContextMock.mockResolvedValue(ctxSenzaPermesso());
    const res = await extractPermessoAction(validRef('permesso'));
    expect(res).toEqual({ ok: false, error: PERMESSO_NEGATO });
    expect(ocrExtractTextMock).not.toHaveBeenCalled();
  });

  it('con pratiche.create supera il gate (Document AI viene invocato)', async () => {
    getSessionContextMock.mockResolvedValue(ctxConPermesso());
    const res = await extractPermessoAction(validRef('permesso'));
    expect(res).toEqual({
      ok: false,
      error: 'OCR non riuscito sul permesso. Ricarica un file leggibile.',
    });
    expect(ocrExtractTextMock).toHaveBeenCalled();
  });
});

describe('extractCodiceFiscaleAction — capability', () => {
  it('senza pratiche.create rifiuta e non invoca Document AI', async () => {
    getSessionContextMock.mockResolvedValue(ctxSenzaPermesso());
    const res = await extractCodiceFiscaleAction(validRef('cf'));
    expect(res).toEqual({ ok: false, error: PERMESSO_NEGATO });
    expect(ocrExtractTextMock).not.toHaveBeenCalled();
  });

  it('con pratiche.create supera il gate (Document AI viene invocato)', async () => {
    getSessionContextMock.mockResolvedValue(ctxConPermesso());
    const res = await extractCodiceFiscaleAction(validRef('cf'));
    expect(res).toEqual({
      ok: false,
      error: 'OCR non riuscito sulla tessera sanitaria. Ricarica un file leggibile.',
    });
    expect(ocrExtractTextMock).toHaveBeenCalled();
  });
});

/**
 * submitNuovaPraticaAction non passa da `gateCreazione()`: chiama
 * `requirePermesso('pratiche.create')` direttamente (stesso permesso, punto
 * diverso). Costruire un FormData che superi TUTTO lo schema/i documenti
 * richiesti fino alla scrittura DB è oneroso (schema Zod con veicoli,
 * venditori, documenti richiesti dall'engine, OCR di cross-check…): ci si
 * limita quindi, come da indicazione, al caso "senza permesso" — che è anche
 * quello che conta di più per il costo OCR/DB — verificando sia il messaggio
 * di rifiuto sia che NESSUNA scrittura DB avvenga.
 */
describe('submitNuovaPraticaAction — capability', () => {
  it('senza pratiche.create rifiuta e non scrive nulla su DB', async () => {
    getSessionContextMock.mockResolvedValue(ctxSenzaPermesso());
    const fd = new FormData();

    await expect(submitNuovaPraticaAction(fd)).rejects.toThrow(/__REDIRECT__/);

    const url = redirectMock.mock.calls.at(-1)?.[0] as string;
    expect(decodeURIComponent(url)).toContain(PERMESSO_NEGATO);
    expect(prismaMock.pratica.create).not.toHaveBeenCalled();
    expect(ocrExtractTextMock).not.toHaveBeenCalled();
  });
});
