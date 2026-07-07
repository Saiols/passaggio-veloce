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
