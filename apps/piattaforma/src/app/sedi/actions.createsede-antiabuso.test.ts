import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * IMPORTANT (review finale branch): l'anti-abuso era aggirabile creando una
 * sede nuova. `createSedeAction` non guardava se l'azienda aveva già una
 * sede sanzionata (`suspensionOrigin: 'ANTI_ABUSO'`): l'agenzia colpita
 * apriva semplicemente una sede nuova e rientrava in distribuzione.
 *
 * Decisione del titolare: si blocca. `createSedeAction` deve rifiutare se
 * l'azienda ha almeno una sede non cancellata con `suspendedAt != null` e
 * `suspensionOrigin === 'ANTI_ABUSO'`.
 */

const { prismaMock, authMock, redirectMock } = vi.hoisted(() => ({
  prismaMock: {
    company: { findUnique: vi.fn() },
    sede: { findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn() },
  },
  authMock: vi.fn(),
  redirectMock: vi.fn((url: string) => {
    throw new Error(`__REDIRECT__:${url}`);
  }),
}));

vi.mock('@pv/db', () => ({ prisma: prismaMock }));
vi.mock('@/auth', () => ({ auth: authMock }));
vi.mock('next/navigation', () => ({ redirect: redirectMock }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { createSedeAction } from './actions';

const COMPANY = 'company-1';

function validFormData(): FormData {
  const fd = new FormData();
  fd.set('nome', 'Sede Nuova');
  fd.set('indirizzo', 'Via Roma');
  fd.set('civico', '1');
  fd.set('citta', 'Milano');
  fd.set('cap', '20100');
  fd.set('provincia', 'MI');
  fd.set('telefono', '');
  fd.set('email', '');
  fd.set('codiceInterno', '');
  fd.set('iban', '');
  fd.set('payoutThresholdEuro', '');
  return fd;
}

beforeEach(() => {
  vi.clearAllMocks();
  authMock.mockResolvedValue({
    user: { id: 'u-1', role: 'ADMIN_AZIENDA', companyId: COMPANY },
  });
  prismaMock.company.findUnique.mockResolvedValue({ type: 'AGENZIA' });
  prismaMock.sede.findUnique.mockResolvedValue(null); // nessuna collisione referralCode
  prismaMock.sede.create.mockResolvedValue({});
});

describe('createSedeAction — anti-abuso non aggirabile con una sede nuova', () => {
  it('rifiuta la creazione se l\'azienda ha una sede sospesa ANTI_ABUSO', async () => {
    prismaMock.sede.findFirst.mockResolvedValue({ id: 'sede-sanzionata' });

    const res = await createSedeAction(validFormData());

    expect(res.ok).toBe(false);
    expect(prismaMock.sede.create).not.toHaveBeenCalled();
  });

  it('consente la creazione se le sedi sospese sono di origine UTENTE (nessuna ANTI_ABUSO)', async () => {
    // La query è scopata su suspensionOrigin: 'ANTI_ABUSO', quindi una sede
    // sospesa dall'utente non produce match: findFirst ritorna null.
    prismaMock.sede.findFirst.mockResolvedValue(null);

    const res = await createSedeAction(validFormData());

    expect(res).toEqual({ ok: true });
    expect(prismaMock.sede.create).toHaveBeenCalledTimes(1);
  });

  it('consente la creazione se non ci sono sedi sospese (caso normale)', async () => {
    prismaMock.sede.findFirst.mockResolvedValue(null);

    const res = await createSedeAction(validFormData());

    expect(res).toEqual({ ok: true });
    expect(prismaMock.sede.create).toHaveBeenCalledTimes(1);
  });
});
