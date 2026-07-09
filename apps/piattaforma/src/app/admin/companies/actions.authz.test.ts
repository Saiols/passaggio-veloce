import { describe, it, expect, vi, beforeEach } from 'vitest';

const { authMock, prismaMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  prismaMock: {
    company: { findUnique: vi.fn(), update: vi.fn() },
  },
}));

vi.mock('@pv/db', () => ({ prisma: prismaMock }));
vi.mock('@/auth', () => ({ auth: authMock }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { updateCompanyAdminAction } from './actions';

const IBAN = 'IT60X0542811101000000123456';

/** FormData che supera `updateSchema`: i casi DENY devono fermarsi sul gate, non sul parsing. */
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
  return fd;
}

function lastUpdateData(): Record<string, unknown> {
  const call = prismaMock.company.update.mock.calls.at(-1);
  return (call?.[0] as { data: Record<string, unknown> }).data;
}

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.company.findUnique.mockResolvedValue({ id: 'c1' });
});

describe("updateCompanyAdminAction — l'IBAN è riservato ad ADMIN_PIATTAFORMA", () => {
  it('ADMIN_PIATTAFORMA → iban nei data, uppercased', async () => {
    authMock.mockResolvedValue({ user: { id: 'a1', role: 'ADMIN_PIATTAFORMA' } });
    const fd = validFormData();
    fd.set('iban', IBAN.toLowerCase());

    const res = await updateCompanyAdminAction('c1', fd);

    expect(res.ok).toBe(true);
    expect(lastUpdateData().iban).toBe(IBAN);
  });

  it('ASSISTENTE → salva l\'anagrafica, ma i data NON contengono iban', async () => {
    authMock.mockResolvedValue({ user: { id: 'a2', role: 'ASSISTENTE' } });

    const res = await updateCompanyAdminAction('c1', validFormData());

    expect(res.ok).toBe(true);
    const data = lastUpdateData();
    // `iban: null` non sarebbe un permesso negato: cancellerebbe l'IBAN dell'azienda.
    expect(data).not.toHaveProperty('iban');
    expect(data.ragioneSociale).toBe('Broker Test SRL');
  });

  it('ASSISTENTE che forgia la POST con un IBAN → il valore è ignorato', async () => {
    authMock.mockResolvedValue({ user: { id: 'a2', role: 'ASSISTENTE' } });
    const fd = validFormData();
    fd.set('iban', 'IT40S0542811101000000123456');

    await updateCompanyAdminAction('c1', fd);

    expect(lastUpdateData()).not.toHaveProperty('iban');
  });

  it('ADMIN_AZIENDA → negato, company.update non chiamato', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN_AZIENDA' } });

    const res = await updateCompanyAdminAction('c1', validFormData());

    expect(res.ok).toBe(false);
    expect(prismaMock.company.update).not.toHaveBeenCalled();
  });
});
