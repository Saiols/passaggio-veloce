import { describe, it, expect, vi, beforeEach } from 'vitest';

const { getSessionContextMock, prismaMock } = vi.hoisted(() => ({
  getSessionContextMock: vi.fn(),
  prismaMock: {
    sede: { update: vi.fn(), findUnique: vi.fn() },
  },
}));

vi.mock('@pv/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/auth/session-context', () => ({ getSessionContext: getSessionContextMock }));
vi.mock('@/auth', () => ({ auth: vi.fn(() => Promise.resolve({ user: { id: 'u1' } })) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { updateSedeAction } from './actions';

const SEDE = { id: 's1', nome: 's1', type: 'AGENZIA' as const };
const IBAN_ATTUALE = 'IT60X0542811101000000123456';

/** Contesto di sessione con i permessi indicati, scopato su `s1`. */
const ctxConPermessi = (permessi: string[], overrides: Record<string, unknown> = {}) => ({
  user: { id: 'u1', role: 'UTENTE_AZIENDA' },
  companyId: 'c1',
  companyType: 'AGENZIA' as const,
  isOwner: false,
  accessibleSedi: [SEDE],
  currentSede: { kind: 'ONE' as const, sede: SEDE },
  scopeIds: ['s1'],
  membershipRuoli: { s1: 'ADMIN_SEDE' as const },
  permessi: new Set(permessi),
  sospensione: { sospeso: false, motivo: null, origine: null },
  ...overrides,
});

/**
 * FormData valida per parseSedeFields — usata anche nei casi DENY (non solo
 * con i permessi giusti): se un gate venisse rimosso, questa FormData
 * supererebbe il parsing e arriverebbe a `prisma.sede.update`, quindi i test
 * DENY restano una guardia reale sul gate (non falsi positivi dovuti a un
 * parse-error precedente).
 */
function validFormData(iban = IBAN_ATTUALE): FormData {
  const fd = new FormData();
  fd.set('nome', 'Sede Test');
  fd.set('indirizzo', 'Via Roma');
  fd.set('civico', '1');
  fd.set('citta', 'Milano');
  fd.set('cap', '20100');
  fd.set('provincia', 'MI');
  fd.set('telefono', '');
  fd.set('email', '');
  fd.set('codiceInterno', '');
  fd.set('iban', iban);
  fd.set('payoutThresholdEuro', '1200');
  return fd;
}

/** I `data` passati all'ultima `prisma.sede.update`. */
function lastUpdateData(): Record<string, unknown> {
  const call = prismaMock.sede.update.mock.calls.at(-1);
  return (call?.[0] as { data: Record<string, unknown> }).data;
}

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.sede.findUnique.mockResolvedValue({ iban: IBAN_ATTUALE });
  getSessionContextMock.mockResolvedValue(ctxConPermessi(['sede.view', 'sede.edit']));
});

describe('updateSedeAction — capability (sede.edit)', () => {
  it('senza sede.edit → negato, sede.update NON chiamato', async () => {
    getSessionContextMock.mockResolvedValue(ctxConPermessi(['sede.view']));
    const res = await updateSedeAction('s1', validFormData());
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain('permessi');
    expect(prismaMock.sede.update).not.toHaveBeenCalled();
  });

  it('senza sede.edit: il gate blocca PRIMA di leggere la sede (permesso prima dello scope)', async () => {
    getSessionContextMock.mockResolvedValue(ctxConPermessi(['sede.view']));
    await updateSedeAction('s1', validFormData());
    expect(prismaMock.sede.findUnique).not.toHaveBeenCalled();
  });

  it('con sede.edit → consentito, sede.update chiamato una volta', async () => {
    const res = await updateSedeAction('s1', validFormData());
    expect(res.ok).toBe(true);
    expect(prismaMock.sede.update).toHaveBeenCalledTimes(1);
  });

  it('proprietario → consentito anche senza permessi espliciti (isOwner bypassa)', async () => {
    getSessionContextMock.mockResolvedValue(ctxConPermessi([], { isOwner: true }));
    const res = await updateSedeAction('s1', validFormData());
    expect(res.ok).toBe(true);
  });
});

describe('updateSedeAction — scope (sedeId esterno)', () => {
  it('sede non tra le accessibili → negato, sede.update NON chiamato', async () => {
    const res = await updateSedeAction('altra-sede', validFormData());
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain('non trovata');
    expect(prismaMock.sede.update).not.toHaveBeenCalled();
  });
});

/**
 * Impostazioni di incasso (IBAN + soglia payout): owner-only in scrittura,
 * D1/D2 di docs/superpowers/specs/2026-07-10-iban-solo-super-admin-design.md.
 * Non sono più una capability delegabile (`sede.iban` è uscita dal catalogo,
 * e `sede.edit` non basta più). Il meccanismo è l'omissione dall'oggetto
 * `data`, non un rifiuto condizionato al cambio di valore (§3.2 della spec):
 * un non-proprietario che forgia la POST con un IBAN diverso ottiene
 * `{ok: true}` — l'anagrafica si salva — ma `sede.update` viene chiamato con
 * `data` privo delle chiavi `iban` e `payoutThresholdCent`, quindi il valore
 * a DB non cambia. Questo chiude anche il wipe: `iban=""` non azzera nulla,
 * perché la chiave non entra mai in `data` per chi non è owner.
 */
describe('updateSedeAction — impostazioni di incasso (owner-only, D1/D2)', () => {
  it('un non-proprietario con sede.edit: salva, ma "data" non contiene iban né payoutThresholdCent', async () => {
    getSessionContextMock.mockResolvedValue(ctxConPermessi(['sede.view', 'sede.edit']));
    const fd = validFormData('IT99Z0000000000000000000000');

    const res = await updateSedeAction('s1', fd);

    expect(res.ok).toBe(true);
    expect(prismaMock.sede.update).toHaveBeenCalledTimes(1);
    const data = lastUpdateData();
    expect(data).not.toHaveProperty('iban');
    expect(data).not.toHaveProperty('payoutThresholdCent');
  });

  it('un non-proprietario con sede.edit e iban="" (tentativo di azzerare): "data" resta priva di iban', async () => {
    getSessionContextMock.mockResolvedValue(ctxConPermessi(['sede.view', 'sede.edit']));
    const fd = validFormData(''); // la sede ha IBAN_ATTUALE valorizzato, il form arriva con iban vuoto

    const res = await updateSedeAction('s1', fd);

    expect(res.ok).toBe(true);
    expect(lastUpdateData()).not.toHaveProperty('iban');
  });

  it('il proprietario: "data" contiene iban e payoutThresholdCent col valore inviato', async () => {
    getSessionContextMock.mockResolvedValue(ctxConPermessi([], { isOwner: true }));
    const fd = validFormData('IT99Z0000000000000000000000');

    const res = await updateSedeAction('s1', fd);

    expect(res.ok).toBe(true);
    const data = lastUpdateData();
    expect(data).toHaveProperty('iban', 'IT99Z0000000000000000000000');
    expect(data).toHaveProperty('payoutThresholdCent', 120_000);
  });
});
