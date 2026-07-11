import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Gate di scoping per sede su `segnalaPraticaAction`.
 *
 * Segnalare una pratica NON è un'azione neutra: apre una segnalazione contro il
 * broker e, se l'admin la conferma, gli addebita una penale di €25. Prima di
 * questo gate bastava conoscere l'UUID: un utente della sede A poteva segnalare
 * una pratica accettata dalla sede B, coinvolgendo un broker con cui la sua
 * sede non ha mai lavorato.
 *
 * Come negli altri test authz, il gate sede precede il controllo di stato: il
 * messaggio d'errore distingue "respinto dal gate" da "gate superato".
 */

const { prismaMock, authMock, getSessionContextMock, redirectMock } = vi.hoisted(() => ({
  // La segnalazione è denormalizzata su `Pratica` (flagSegnalata, tipoSegnalazione,
  // …): non esiste un modello dedicato, e `segnalaPraticaAction` non apre una
  // transazione. Il mock rispecchia esattamente ciò che l'action tocca.
  prismaMock: {
    pratica: { findUnique: vi.fn(), update: vi.fn() },
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
vi.mock('@/lib/notifiche', () => ({
  sendNotification: vi.fn(() => Promise.resolve()),
  getAdminEmails: vi.fn(() => Promise.resolve([])),
  notifyClientiAvanzamento: vi.fn(() => Promise.resolve()),
}));
vi.mock('@/lib/eventi/emit', () => ({ emitEventiPratica: vi.fn(() => Promise.resolve()) }));
vi.mock('@/lib/eventi/pratica-eventi', () => ({ eventoPraticaPenale: vi.fn(() => ({})) }));

import { segnalaPraticaAction } from './segnalazione';

const AGENZIA = 'ag-1';
const SEDE_MIA = 'sede-mia';
const SEDE_ALTRA = 'sede-altra';
const PID = '22222222-2222-4222-8222-222222222222';

const pratica = (over: Record<string, unknown> = {}) => ({
  id: PID,
  stato: 'ACCETTATA',
  brokerId: 'br-1',
  brokerSedeId: 'sede-broker',
  agenziaAssegnataId: AGENZIA,
  agenziaSedeId: SEDE_ALTRA,
  flagSegnalata: false,
  codicePratica: 'PV-1',
  veicoli: [{ targa: 'AA000AA' }],
  broker: { ragioneSociale: 'Broker' },
  agenziaAssegnata: { ragioneSociale: 'Agenzia' },
  ...over,
});

/** Contesto di sessione con i permessi indicati (per i test di capability). */
function ctxConPermessi(permessi: string[], overrides: Record<string, unknown> = {}) {
  return {
    user: { id: 'u1', companyId: AGENZIA, companyType: 'AGENZIA', role: 'OPERATORE' },
    companyId: AGENZIA,
    companyType: 'AGENZIA' as const,
    isOwner: false,
    accessibleSedi: [{ id: SEDE_MIA, nome: 'Mia', type: 'AGENZIA' }],
    currentSede: { kind: 'ONE', sede: { id: SEDE_MIA, nome: 'Mia', type: 'AGENZIA' } },
    scopeIds: [SEDE_MIA],
    membershipRuoli: { [SEDE_MIA]: 'OPERATORE' },
    permessi: new Set(permessi),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  authMock.mockResolvedValue({
    user: { id: 'u1', companyId: AGENZIA, companyType: 'AGENZIA', role: 'OPERATORE' },
  });
  getSessionContextMock.mockResolvedValue(ctxConPermessi(['pratiche.view', 'pratiche.segnala']));
});

describe('segnalaPraticaAction — scoping sede', () => {
  it('rifiuta la segnalazione di una pratica di un\'altra sede (nessuna penale al broker)', async () => {
    prismaMock.pratica.findUnique.mockResolvedValue(pratica());

    const res = await segnalaPraticaAction(PID, 'FERMO_AMMINISTRATIVO', 'nota', ['veicolo-1']);

    expect(res).toEqual({ ok: false, error: 'Pratica non assegnata alla tua sede' });
    expect(prismaMock.pratica.update).not.toHaveBeenCalled();
  });

  it('rifiuta la pratica di un\'altra agenzia', async () => {
    prismaMock.pratica.findUnique.mockResolvedValue(
      pratica({ agenziaAssegnataId: 'ag-estranea', agenziaSedeId: SEDE_MIA }),
    );

    const res = await segnalaPraticaAction(PID, 'FERMO_AMMINISTRATIVO', 'nota', ['veicolo-1']);

    expect(res).toEqual({ ok: false, error: 'Pratica non assegnata alla tua agenzia' });
  });

  it('accetta la pratica della propria sede (supera il gate, prosegue sullo stato)', async () => {
    prismaMock.pratica.findUnique.mockResolvedValue(
      pratica({ agenziaSedeId: SEDE_MIA, stato: 'FIRMATA' }),
    );

    const res = await segnalaPraticaAction(PID, 'FERMO_AMMINISTRATIVO', 'nota', ['veicolo-1']);

    // Asserzione ESATTA sul messaggio di stato: una negativa
    // (`not.toEqual(errore-di-sede)`) passerebbe anche se il gate negasse con
    // un messaggio qualsiasi, quindi non proverebbe che il gate è stato superato.
    expect(res).toEqual({
      ok: false,
      error: 'Le segnalazioni sono possibili solo prima della firma',
    });
  });
});

/**
 * Gate di CAPABILITY (permesso): precede lo scoping sede (autenticazione →
 * permesso → scope). Segnalare apre una penale di €25 al broker, quindi non è
 * un'azione neutra da lasciare a chiunque abbia solo `pratiche.view`.
 */
describe('segnalaPraticaAction — capability', () => {
  it('un operatore senza pratiche.segnala non apre la segnalazione', async () => {
    getSessionContextMock.mockResolvedValue(ctxConPermessi(['pratiche.view']));

    const res = await segnalaPraticaAction(PID, 'FERMO_AMMINISTRATIVO', 'nota', ['veicolo-1']);

    expect(res).toEqual({ ok: false, error: 'Non hai i permessi per questa azione' });
    expect(prismaMock.pratica.update).not.toHaveBeenCalled();
    expect(prismaMock.pratica.findUnique).not.toHaveBeenCalled();
  });

  it('con pratiche.segnala: supera il gate (arriva al controllo di company/sede)', async () => {
    getSessionContextMock.mockResolvedValue(ctxConPermessi(['pratiche.view', 'pratiche.segnala']));
    prismaMock.pratica.findUnique.mockResolvedValue(pratica());

    const res = await segnalaPraticaAction(PID, 'FERMO_AMMINISTRATIVO', 'nota', ['veicolo-1']);

    expect(res).toEqual({ ok: false, error: 'Pratica non assegnata alla tua sede' });
  });
});
