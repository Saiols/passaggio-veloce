import { describe, it, expect, vi, beforeEach } from 'vitest';

const { feeFindUnique, companyFindUnique, companyUpdate, feeCount, sendMock } = vi.hoisted(() => ({
  feeFindUnique: vi.fn(),
  companyFindUnique: vi.fn(),
  companyUpdate: vi.fn(),
  feeCount: vi.fn(),
  sendMock: vi.fn(),
}));

vi.mock('@pv/db', () => ({
  prisma: {
    feeAddebito: { findUnique: feeFindUnique, count: feeCount },
    company: { findUnique: companyFindUnique, update: companyUpdate },
  },
}));
vi.mock('@/lib/notifiche', () => ({ sendNotification: sendMock }));

import { bloccaAgenziaPerAddebito, rivalutaBloccoAgenzia, isAgenziaBloccata } from './blocco';

beforeEach(() => {
  vi.clearAllMocks();
  companyUpdate.mockResolvedValue({});
  sendMock.mockResolvedValue(undefined);
});

describe('bloccaAgenziaPerAddebito', () => {
  it('prima transizione: setta bloccoPagamentoAt + invia N9', async () => {
    feeFindUnique.mockResolvedValue({ agenziaId: 'a1' });
    companyFindUnique.mockResolvedValue({ id: 'a1', ragioneSociale: 'Ag', email: 'ag@x.it', bloccoPagamentoAt: null });
    await bloccaAgenziaPerAddebito('f1', 'SEPA rifiutato');
    expect(companyUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'a1' },
      data: expect.objectContaining({ bloccoPagamentoMotivo: 'SEPA rifiutato' }),
    }));
    expect(companyUpdate.mock.calls[0][0].data.bloccoPagamentoAt).toBeInstanceOf(Date);
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(sendMock.mock.calls[0][0].tipo).toBe('N9_AGENZIA_ADDEBITO_FALLITO');
  });

  it('già bloccata: aggiorna solo il motivo, niente email', async () => {
    feeFindUnique.mockResolvedValue({ agenziaId: 'a1' });
    companyFindUnique.mockResolvedValue({ id: 'a1', ragioneSociale: 'Ag', email: 'ag@x.it', bloccoPagamentoAt: new Date() });
    await bloccaAgenziaPerAddebito('f1', 'altro errore');
    expect(companyUpdate.mock.calls[0][0].data.bloccoPagamentoAt).toBeUndefined();
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('non propaga errori (best-effort)', async () => {
    feeFindUnique.mockRejectedValue(new Error('db down'));
    await expect(bloccaAgenziaPerAddebito('f1', 'x')).resolves.toBeUndefined();
  });
});

describe('rivalutaBloccoAgenzia', () => {
  it('sblocca se non ci sono fee scoperti/in volo', async () => {
    companyFindUnique.mockResolvedValue({ bloccoPagamentoAt: new Date() });
    feeCount.mockResolvedValue(0);
    await rivalutaBloccoAgenzia('a1');
    expect(companyUpdate).toHaveBeenCalledWith({ where: { id: 'a1' }, data: { bloccoPagamentoAt: null, bloccoPagamentoMotivo: null } });
  });

  it('NON sblocca se restano fee scoperti', async () => {
    companyFindUnique.mockResolvedValue({ bloccoPagamentoAt: new Date() });
    feeCount.mockResolvedValue(2);
    await rivalutaBloccoAgenzia('a1');
    expect(companyUpdate).not.toHaveBeenCalled();
  });

  it('no-op se non bloccata', async () => {
    companyFindUnique.mockResolvedValue({ bloccoPagamentoAt: null });
    await rivalutaBloccoAgenzia('a1');
    expect(feeCount).not.toHaveBeenCalled();
    expect(companyUpdate).not.toHaveBeenCalled();
  });
});

describe('isAgenziaBloccata', () => {
  it('true se bloccoPagamentoAt valorizzato', async () => {
    companyFindUnique.mockResolvedValue({ bloccoPagamentoAt: new Date() });
    expect(await isAgenziaBloccata('a1')).toBe(true);
  });
  it('false se null/assente', async () => {
    companyFindUnique.mockResolvedValue({ bloccoPagamentoAt: null });
    expect(await isAgenziaBloccata('a1')).toBe(false);
  });
});
