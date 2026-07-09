import { describe, it, expect, vi, beforeEach } from 'vitest';

const { authMock, prismaMock, ritentaMock, mandateMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  prismaMock: {
    company: { findUnique: vi.fn(), update: vi.fn() },
  },
  ritentaMock: vi.fn(),
  mandateMock: vi.fn(),
}));

vi.mock('@pv/db', () => ({ prisma: prismaMock }));
vi.mock('@/auth', () => ({ auth: authMock }));
vi.mock('@/lib/fee/retry', () => ({ ritentaAddebitiAgenzia: ritentaMock }));
vi.mock('@/lib/providers/payment/stripe-mandate', () => ({
  applySepaMandateToAgency: mandateMock,
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/headers', () => ({
  headers: () => Promise.resolve(new Headers()),
}));

import { aggiornaIbanERitentaAction, ritentaAddebitoAction } from './actions';

/**
 * IBAN con checksum MOD97 CORRETTO (verificato). Indispensabile nei casi DENY:
 * con un IBAN malformato l'action fallirebbe sulla validazione e il test
 * passerebbe senza dimostrare nulla sul gate di autorizzazione.
 */
const IBAN_VALIDO = 'IT60X0542811101000000123456';

function sessione(role: string) {
  return {
    user: { id: 'u1', role, companyType: 'AGENZIA', companyId: 'ag1' },
  };
}

function formIban(): FormData {
  const fd = new FormData();
  fd.set('iban', IBAN_VALIDO);
  return fd;
}

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.company.findUnique.mockResolvedValue({
    ragioneSociale: 'Agenzia Test',
    email: 'agenzia@test.it',
  });
  mandateMock.mockResolvedValue('ACTIVE');
});

describe('aggiornaIbanERitentaAction — solo il titolare cambia l\'IBAN', () => {
  it('UTENTE_AZIENDA → negato: né company.update né mandato SEPA', async () => {
    authMock.mockResolvedValue(sessione('UTENTE_AZIENDA'));

    const res = await aggiornaIbanERitentaAction(formIban());

    expect(res.ok).toBe(false);
    expect(prismaMock.company.update).not.toHaveBeenCalled();
    expect(mandateMock).not.toHaveBeenCalled();
    expect(ritentaMock).not.toHaveBeenCalled();
  });

  it('utente non loggato → negato', async () => {
    authMock.mockResolvedValue(null);

    const res = await aggiornaIbanERitentaAction(formIban());

    expect(res.ok).toBe(false);
    expect(prismaMock.company.update).not.toHaveBeenCalled();
    expect(mandateMock).not.toHaveBeenCalled();
  });

  it('ADMIN_AZIENDA → consentito: aggiorna IBAN e ricrea il mandato', async () => {
    authMock.mockResolvedValue(sessione('ADMIN_AZIENDA'));

    const res = await aggiornaIbanERitentaAction(formIban());

    expect(res.ok).toBe(true);
    expect(prismaMock.company.update).toHaveBeenCalledWith({
      where: { id: 'ag1' },
      data: { iban: IBAN_VALIDO },
    });
    expect(mandateMock).toHaveBeenCalledTimes(1);
  });

  it('ADMIN_AZIENDA di un DEALER → negato (la pagina è solo per le agenzie)', async () => {
    authMock.mockResolvedValue({
      user: { id: 'u1', role: 'ADMIN_AZIENDA', companyType: 'DEALER', companyId: 'br1' },
    });

    const res = await aggiornaIbanERitentaAction(formIban());

    expect(res.ok).toBe(false);
    expect(prismaMock.company.update).not.toHaveBeenCalled();
  });
});

describe('ritentaAddebitoAction — resta aperta a tutta l\'agenzia', () => {
  it('UTENTE_AZIENDA può ritentare: non tocca IBAN né importi', async () => {
    authMock.mockResolvedValue(sessione('UTENTE_AZIENDA'));

    const res = await ritentaAddebitoAction();

    expect(res.ok).toBe(true);
    expect(ritentaMock).toHaveBeenCalledWith('ag1');
    expect(prismaMock.company.update).not.toHaveBeenCalled();
  });
});
