import { describe, it, expect, vi, beforeEach } from 'vitest';

const { getSedeRoleMock, prismaMock } = vi.hoisted(() => ({
  getSedeRoleMock: vi.fn(),
  prismaMock: {
    sede: { update: vi.fn() },
  },
}));

vi.mock('@pv/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/auth/session-context', () => ({ getSedeRole: getSedeRoleMock }));
vi.mock('@/auth', () => ({ auth: vi.fn(() => Promise.resolve({ user: { id: 'u1' } })) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { updateSedeAction } from './actions';

/**
 * FormData valida per parseSedeFields — usata anche nei casi DENY (non solo
 * ADMIN_SEDE): se il gate `canEditSedeSettings` venisse rimosso, questa
 * FormData supererebbe il parsing e arriverebbe a `prisma.sede.update`,
 * quindi i test DENY restano una guardia reale sul gate (non falsi positivi
 * dovuti a un parse-error precedente).
 */
function validFormData(): FormData {
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
  fd.set('iban', '');
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
});

describe('updateSedeAction — gate autorizzazione impostazioni sede', () => {
  it('OPERATORE → negato, sede.update NON chiamato', async () => {
    getSedeRoleMock.mockResolvedValue('OPERATORE');
    const res = await updateSedeAction('s1', validFormData());
    expect(res.ok).toBe(false);
    expect(prismaMock.sede.update).not.toHaveBeenCalled();
  });

  it('sede non accessibile (ruolo null) → negato, sede.update NON chiamato', async () => {
    getSedeRoleMock.mockResolvedValue(null);
    const res = await updateSedeAction('s1', validFormData());
    expect(res.ok).toBe(false);
    expect(prismaMock.sede.update).not.toHaveBeenCalled();
  });

  it('ADMIN_SEDE → consentito, sede.update chiamato una volta', async () => {
    getSedeRoleMock.mockResolvedValue('ADMIN_SEDE');
    const res = await updateSedeAction('s1', validFormData());
    expect(res.ok).toBe(true);
    expect(prismaMock.sede.update).toHaveBeenCalledTimes(1);
  });
});

/**
 * Impostazioni di incasso (IBAN + soglia payout): solo il proprietario della
 * madre. Le asserzioni usano `not.toHaveProperty` e non un confronto di valore,
 * così falliscono anche quando l'action scrive `iban: null` — che non sarebbe
 * un permesso negato ma una CANCELLAZIONE dell'IBAN della sede.
 */
describe('updateSedeAction — IBAN e soglia payout sono owner-only', () => {
  it('OWNER → iban e payoutThresholdCent finiscono nei data', async () => {
    getSedeRoleMock.mockResolvedValue('OWNER');
    const fd = validFormData();
    fd.set('iban', 'IT60X0542811101000000123456');

    const res = await updateSedeAction('s1', fd);

    expect(res.ok).toBe(true);
    const data = lastUpdateData();
    expect(data.iban).toBe('IT60X0542811101000000123456');
    expect(data.payoutThresholdCent).toBe(120_000);
  });

  it('ADMIN_SEDE → i data NON contengono iban né payoutThresholdCent', async () => {
    getSedeRoleMock.mockResolvedValue('ADMIN_SEDE');

    const res = await updateSedeAction('s1', validFormData());

    expect(res.ok).toBe(true);
    const data = lastUpdateData();
    expect(data).not.toHaveProperty('iban');
    expect(data).not.toHaveProperty('payoutThresholdCent');
    // l'anagrafica passa comunque
    expect(data.nome).toBe('Sede Test');
  });

  it('ADMIN_SEDE con iban vuoto → NON azzera l\'IBAN esistente della sede', async () => {
    getSedeRoleMock.mockResolvedValue('ADMIN_SEDE');
    const fd = validFormData();
    fd.set('iban', ''); // il campo non è nel form: FormData lo manda vuoto

    await updateSedeAction('s1', fd);

    // `iban: null` cancellerebbe l'IBAN a DB: la chiave non deve esserci proprio.
    expect(lastUpdateData()).not.toHaveProperty('iban');
  });

  it('ADMIN_SEDE che forgia la POST con un IBAN valido → il valore è ignorato', async () => {
    getSedeRoleMock.mockResolvedValue('ADMIN_SEDE');
    const fd = validFormData();
    fd.set('iban', 'IT40S0542811101000000123456'); // strutturalmente valido: il gate è l'unica difesa
    fd.set('payoutThresholdEuro', '1');

    await updateSedeAction('s1', fd);

    const data = lastUpdateData();
    expect(data).not.toHaveProperty('iban');
    expect(data).not.toHaveProperty('payoutThresholdCent');
  });
});
