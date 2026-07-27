import { describe, it, expect, vi, beforeEach } from 'vitest';
import { sessionCtx, buildValidFormData, DEALER } from './test-harness';

/**
 * Attestazioni pre-invio (spec 2026-07-27, Task 4): il submit deve validare
 * `dichiarazionePopupVersion` contro il registro (`attestazioniPerVersione`),
 * leggere i testi persistiti DAL REGISTRO server-side (mai dal payload
 * client) e scrivere `BrokerDichiarazione` DENTRO la stessa transazione della
 * pratica — prima era un log best-effort in un catch vuoto: se falliva, la
 * pratica partiva comunque e la prova non esisteva, senza che nessuno se ne
 * accorgesse.
 *
 * Fixture di sessione/FormData/mock Prisma condivise con
 * `actions.submit-distribuzione.test.ts` via `./test-harness` — le chiamate
 * `vi.mock(...)` invece restano qui: Vitest le hoista per-modulo.
 *
 * `prismaMock` e `txMock` sono DUE client distinti (vedi `test-harness.ts`):
 * `txMock.brokerDichiarazione.create` è quello che il codice DEVE chiamare
 * (dentro `$transaction`); `prismaMock.brokerDichiarazione.create` non deve
 * MAI essere invocato. Con un solo mock condiviso per i due client, uno
 * scrittore che tornasse a scrivere fuori transazione (con l'errore
 * comunque propagato, senza il vecchio `catch` vuoto) risulterebbe
 * indistinguibile da quello corretto — è la distinzione che rende il test
 * sull'atomicità (sotto) una prova reale, non solo della propagazione
 * dell'eccezione.
 */

const {
  authMock,
  getSessionContextMock,
  prismaMock,
  txMock,
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
} = await vi.hoisted(async () => {
  const { createPrismaMock } = await import('./test-harness');
  const { prismaMock, txMock } = createPrismaMock();

  const ocrExtractTextMock = vi.fn(async () => ({ text: 'stub ocr text', confidence: 1 }));

  return {
    authMock: vi.fn(),
    getSessionContextMock: vi.fn(),
    prismaMock,
    txMock,
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

import { attestazioniPerVersione } from '@/lib/legal/attestazioni';

beforeEach(() => {
  vi.clearAllMocks();
  authMock.mockResolvedValue({
    user: { id: 'u1', companyId: DEALER, companyType: 'DEALER', role: 'OPERATORE' },
  });
  getSessionContextMock.mockResolvedValue(sessionCtx());
  ocrExtractTextMock.mockResolvedValue({ text: 'stub ocr text', confidence: 1 });
  storageGetBufferMock.mockResolvedValue(Buffer.from('stub-bytes'));
  getStorageMock.mockReturnValue({ name: 'local' });
  prismaMock.$transaction.mockImplementation(async (cb: (t: unknown) => unknown) => cb(txMock));
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

/**
 * Import dinamico (non un `import` statico in testa al file): deve avvenire
 * DOPO che i `vi.mock(...)` sopra sono attivi, altrimenti `submitNuovaPraticaAction`
 * catturerebbe i moduli reali invece dei mock.
 */
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

    // La scrittura deve avvenire sul client di transazione, mai su quello
    // esterno — vedi il commento in testa al file sul perché i due mock sono
    // distinti.
    expect(txMock.brokerDichiarazione.create).toHaveBeenCalledTimes(1);
    expect(prismaMock.brokerDichiarazione.create).not.toHaveBeenCalled();

    const { data } = txMock.brokerDichiarazione.create.mock.calls[0]![0];
    expect(data.popupVersion).toBe('v4.0');
    expect(data.clausolaTerzi).toBe(23);
    expect(data.testoAttestazioni).toEqual(
      attestazioniPerVersione('v4.0')!.attestazioni.map((a) => ({ id: a.id, testo: a.testo })),
    );
  });

  // Il registro tiene anche le versioni storiche (vedi `attestazioni.ts`):
  // è quello che rende accettabile fidarsi della versione mandata dal client
  // (il browser può avere ancora il bundle di un deploy precedente). Una
  // versione storica nota va accettata e deve persistere IL SUO testo, non
  // quello — diverso — della versione corrente. `attestazioneTerziAccettata`
  // è OMESSO (non 'false'): un client v3.1 reale non poteva mandarlo, il
  // campo non esisteva ancora in quel bundle — è esattamente il payload che
  // quel browser produce davvero (Finding 3, review whole-branch 2026-07-27).
  it('una versione storica nota viene accettata con il payload che un client v3.1 poteva davvero mandare', async () => {
    const url = await submit(
      buildValidFormData({
        dichiarazionePopupVersion: 'v3.1',
        attestazioneTerziAccettata: undefined,
      }),
    );
    expect(url).toBeNull();

    const { data } = txMock.brokerDichiarazione.create.mock.calls[0]![0];
    expect(data.popupVersion).toBe('v3.1');
    expect(data.clausolaTerzi).toBe(23);
    expect(data.testoAttestazioni).toEqual(
      attestazioniPerVersione('v3.1')!.attestazioni.map((a) => ({ id: a.id, testo: a.testo })),
    );
    expect(data.testoAttestazioni).not.toEqual(
      attestazioniPerVersione('v4.0')!.attestazioni.map((a) => ({ id: a.id, testo: a.testo })),
    );
  });

  // Il testo e' merce del server. Un payload manomesso non deve poter scrivere
  // nel record una dichiarazione diversa da quella resa a schermo.
  it('ignora un testo iniettato dal client', async () => {
    await submit(buildValidFormData({ testoAttestazioni: '[{"id":"TERZI","testo":"nulla"}]' }));
    const { data } = txMock.brokerDichiarazione.create.mock.calls[0]![0];
    expect(JSON.stringify(data.testoAttestazioni)).not.toContain('nulla');
  });

  // IL test della release: prima era un log best-effort in un catch vuoto, e
  // una pratica poteva partire senza la sua prova senza che nessuno lo sapesse.
  // Il rigetto deve avvenire PERCHÉ la create è dentro la transazione: se
  // tornasse fuori (anche senza il vecchio `catch` vuoto, con l'errore
  // comunque propagato), forzare il fallimento su `txMock` non fermerebbe più
  // nulla — la scrittura vera finirebbe sul `prismaMock` esterno, che qui non
  // viene mai fatto fallire, e la pratica risulterebbe comunque creata.
  it('se la scrittura della prova fallisce, la pratica non esiste', async () => {
    txMock.brokerDichiarazione.create.mockRejectedValueOnce(new Error('db down'));
    await expect(submit(buildValidFormData())).rejects.toThrow('db down');
    expect(avviaRound1ForPraticaMock).not.toHaveBeenCalled();
  });

  it("l'IP registrato resta anonimizzato a 3 ottetti", async () => {
    await submit(buildValidFormData());
    const { data } = txMock.brokerDichiarazione.create.mock.calls[0]![0];
    // Valore esatto, non solo il pattern finale: prova che anche i primi tre
    // ottetti sono quelli in arrivo (93.45.201.77), non un valore qualsiasi
    // che per caso termina in ".x".
    expect(data.ip).toBe('93.45.201.x');
  });
});
