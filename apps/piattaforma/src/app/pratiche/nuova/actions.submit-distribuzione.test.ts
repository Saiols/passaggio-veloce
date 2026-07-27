import { describe, it, expect, vi, beforeEach } from 'vitest';
import { sessionCtx, buildValidFormData, DEALER } from './test-harness';

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
 *
 * Fixture di sessione/FormData/mock Prisma condivise con
 * `actions.attestazioni.test.ts` via `./test-harness` — le chiamate
 * `vi.mock(...)` invece restano qui: Vitest le hoista per-modulo.
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
