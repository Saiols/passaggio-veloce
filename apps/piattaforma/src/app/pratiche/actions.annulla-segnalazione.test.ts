import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * CRITICAL 1 (review finale branch): il broker annullava la pratica e
 * schivava la penale. `annullaPraticaAction` bloccava solo gli stati FIRMATA
 * e ANNULLATA, ma non guardava `flagSegnalata`/`segnalazioneStato`.
 *
 * Scenario: l'agenzia segnala un fermo (penale futura). Il broker apre la
 * pratica, vede l'alert di segnalazione e clicca comunque "Annulla pratica".
 * Pratica -> ANNULLATA. Quando l'admin prova a confermare la penale,
 * `segnalazione.ts` lancia 'Pratica non più gestibile': la penale non viene
 * mai addebitata e la segnalazione resta appesa per sempre nella coda admin.
 *
 * Una segnalazione IN VERIFICA (RICEVUTA) deve bloccare l'annullamento. Il
 * caso normale (nessuna segnalazione, o segnalazione RESPINTA) deve restare
 * intatto.
 */

const { prismaMock, authMock, getSessionContextMock, redirectMock } = vi.hoisted(() => ({
  prismaMock: {
    pratica: { findUnique: vi.fn(), update: vi.fn() },
    praticaAssegnazione: { updateMany: vi.fn() },
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

// Effetti collaterali post-transazione: neutralizzati, non sono l'oggetto del test.
vi.mock('@/lib/notifiche', () => ({
  sendNotification: vi.fn(() => Promise.resolve()),
  notifyClientiAvanzamento: vi.fn(() => Promise.resolve()),
}));
vi.mock('@/lib/eventi/emit', () => ({ emitEventoPratica: vi.fn(() => Promise.resolve()) }));
vi.mock('@/lib/eventi/pratica-eventi', () => ({
  eventoPraticaLavorata: vi.fn(() => ({})),
  eventoPraticaFirmata: vi.fn(() => ({})),
  eventoPraticaAnnullata: vi.fn(() => ({})),
}));

import { annullaPraticaAction } from './actions';

const PID = '11111111-1111-4111-8111-111111111111';
const BROKER = 'br-1';
const SEDE_MIA = 'sede-mia';

const PERMESSI_DEALER = ['pratiche.view', 'pratiche.create', 'pratiche.annulla', 'pratiche.valuta'];

function sessione(): void {
  authMock.mockResolvedValue({
    user: { id: 'u1', companyId: BROKER, companyType: 'DEALER', role: 'OPERATORE' },
  });
  getSessionContextMock.mockResolvedValue({
    user: { id: 'u1', companyId: BROKER, companyType: 'DEALER', role: 'OPERATORE' },
    companyId: BROKER,
    companyType: 'DEALER',
    isOwner: false,
    accessibleSedi: [{ id: SEDE_MIA, nome: 'Mia', type: 'DEALER' }],
    currentSede: { kind: 'ONE', sede: { id: SEDE_MIA, nome: 'Mia', type: 'DEALER' } },
    scopeIds: [SEDE_MIA],
    membershipRuoli: {},
    permessi: new Set(PERMESSI_DEALER),
  });
}

const pratica = (over: Record<string, unknown> = {}) => ({
  id: PID,
  brokerId: BROKER,
  brokerSedeId: SEDE_MIA,
  agenziaAssegnataId: 'ag-1',
  agenziaSedeId: SEDE_MIA,
  stato: 'ACCETTATA',
  flagSegnalata: false,
  segnalazioneStato: null,
  codicePratica: 'PV-2026-00001',
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  sessione();
  prismaMock.$transaction.mockImplementation(async (cb: (t: unknown) => unknown) => cb(prismaMock));
  prismaMock.pratica.update.mockResolvedValue({});
  prismaMock.praticaAssegnazione.updateMany.mockResolvedValue({});
});

describe('annullaPraticaAction — segnalazione in verifica', () => {
  it('rifiuta l\'annullamento se la segnalazione è RICEVUTA (in verifica)', async () => {
    prismaMock.pratica.findUnique.mockResolvedValue(
      pratica({ flagSegnalata: true, segnalazioneStato: 'RICEVUTA' }),
    );

    await expect(annullaPraticaAction(PID)).rejects.toThrow(/__REDIRECT__/);

    const url = redirectMock.mock.calls.at(-1)?.[0] as string;
    expect(decodeURIComponent(url)).toContain('segnalazione in verifica');
    expect(prismaMock.pratica.update).not.toHaveBeenCalled();
  });

  it('consente l\'annullamento se la segnalazione è stata RESPINTA', async () => {
    prismaMock.pratica.findUnique.mockResolvedValue(
      pratica({ flagSegnalata: false, segnalazioneStato: 'RESPINTA' }),
    );

    await expect(annullaPraticaAction(PID)).rejects.toThrow(/__REDIRECT__/);

    const url = redirectMock.mock.calls.at(-1)?.[0] as string;
    expect(decodeURIComponent(url)).toContain('annullata=1');
    expect(prismaMock.pratica.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: PID } }),
    );
  });

  it('consente l\'annullamento se non c\'è mai stata una segnalazione (caso normale)', async () => {
    prismaMock.pratica.findUnique.mockResolvedValue(
      pratica({ flagSegnalata: false, segnalazioneStato: null }),
    );

    await expect(annullaPraticaAction(PID)).rejects.toThrow(/__REDIRECT__/);

    const url = redirectMock.mock.calls.at(-1)?.[0] as string;
    expect(decodeURIComponent(url)).toContain('annullata=1');
    expect(prismaMock.pratica.update).toHaveBeenCalled();
  });
});
