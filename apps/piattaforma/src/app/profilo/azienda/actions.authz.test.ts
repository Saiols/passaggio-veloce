import { describe, it, expect, vi, beforeEach } from 'vitest';

const { authMock, prismaMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  prismaMock: { company: { update: vi.fn() } },
}));

vi.mock('@pv/db', () => ({ prisma: prismaMock }));
vi.mock('@/auth', () => ({ auth: authMock }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({
  redirect: vi.fn(() => {
    throw new Error('NEXT_REDIRECT');
  }),
}));
// Non è oggetto di questo file: la sospensione ha la propria copertura in
// mappa-enforcement.test.ts. Qui si assume sempre operativo.
vi.mock('@/lib/auth/sospensione-guard', () => ({
  requireOperativita: vi.fn(() => Promise.resolve({ ok: true })),
}));

import { updateCompanyProfileAction } from './actions';

const IBAN = 'IT60X0542811101000000123456';

/** FormData che supera `updateSchema`: il caso DENY si ferma sul gate, non sul parsing. */
function validFormData(): FormData {
  const fd = new FormData();
  fd.set('ragioneSociale', 'Broker Test SRL');
  fd.set('codiceSdi', '');
  fd.set('pec', 'pec@brokertest.it');
  fd.set('email', 'info@brokertest.it');
  fd.set('telefono', '');
  fd.set('indirizzo', 'Via Roma 1');
  fd.set('citta', 'Milano');
  fd.set('cap', '20100');
  fd.set('provincia', 'MI');
  fd.set('iban', IBAN);
  return fd;
}

beforeEach(() => {
  vi.clearAllMocks();
});

/**
 * Regressione: il gate esiste già. Questi test lo inchiodano, così una futura
 * apertura del profilo azienda all'ADMIN_SEDE non porta con sé l'IBAN.
 */
describe('updateCompanyProfileAction — il profilo azienda è owner-only', () => {
  it('UTENTE_AZIENDA → negato, company.update non chiamato', async () => {
    authMock.mockResolvedValue({
      user: { id: 'u1', role: 'UTENTE_AZIENDA', companyId: 'c1' },
    });

    const res = await updateCompanyProfileAction(validFormData());

    expect(res.ok).toBe(false);
    expect(prismaMock.company.update).not.toHaveBeenCalled();
  });

  it('ADMIN_AZIENDA → consentito, IBAN scritto uppercased', async () => {
    authMock.mockResolvedValue({
      user: { id: 'u1', role: 'ADMIN_AZIENDA', companyId: 'c1' },
    });
    const fd = validFormData();
    fd.set('iban', IBAN.toLowerCase());

    const res = await updateCompanyProfileAction(fd);

    expect(res.ok).toBe(true);
    const call = prismaMock.company.update.mock.calls.at(-1);
    expect((call?.[0] as { data: { iban: string } }).data.iban).toBe(IBAN);
  });
});
