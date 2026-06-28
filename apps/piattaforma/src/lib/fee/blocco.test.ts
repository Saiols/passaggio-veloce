import { describe, it, expect, vi, beforeEach } from 'vitest';

const { feeFindUnique, companyFindUnique, companyUpdate, companyUpdateMany, sendMock } = vi.hoisted(() => ({
  feeFindUnique: vi.fn(),
  companyFindUnique: vi.fn(),
  companyUpdate: vi.fn(),
  companyUpdateMany: vi.fn(),
  sendMock: vi.fn(),
}));

vi.mock('@pv/db', () => ({
  prisma: {
    feeAddebito: { findUnique: feeFindUnique },
    company: { findUnique: companyFindUnique, update: companyUpdate, updateMany: companyUpdateMany },
  },
}));
vi.mock('@/lib/notifiche', () => ({ sendNotification: sendMock }));

import { bloccaAgenziaPerAddebito, rivalutaBloccoAgenzia, isAgenziaBloccata, STATI_SCOPERTI } from './blocco';

beforeEach(() => {
  vi.clearAllMocks();
  companyUpdate.mockResolvedValue({});
  companyUpdateMany.mockResolvedValue({ count: 0 });
  sendMock.mockResolvedValue(undefined);
});

describe('bloccaAgenziaPerAddebito', () => {
  it('prima transizione: setta bloccoPagamentoAt + invia N9', async () => {
    feeFindUnique.mockResolvedValue({ agenziaId: 'a1' });
    companyFindUnique.mockResolvedValue({ id: 'a1', ragioneSociale: 'Ag', email: 'ag@x.it', bloccoPagamentoAt: null, sepaMandateStatus: 'ACTIVE' });
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
    companyFindUnique.mockResolvedValue({ id: 'a1', ragioneSociale: 'Ag', email: 'ag@x.it', bloccoPagamentoAt: new Date(), sepaMandateStatus: 'ACTIVE' });
    await bloccaAgenziaPerAddebito('f1', 'altro errore');
    expect(companyUpdate.mock.calls[0][0].data.bloccoPagamentoAt).toBeUndefined();
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('non propaga errori (best-effort)', async () => {
    feeFindUnique.mockRejectedValue(new Error('db down'));
    await expect(bloccaAgenziaPerAddebito('f1', 'x')).resolves.toBeUndefined();
  });

  // FIX #1: mandato non ACTIVE → gap di setup, non rifiuto bancario → non bloccare
  it('no-op se mandato SEPA PENDING (gap di configurazione)', async () => {
    feeFindUnique.mockResolvedValue({ agenziaId: 'a1' });
    companyFindUnique.mockResolvedValue({ id: 'a1', ragioneSociale: 'Ag', email: 'ag@x.it', bloccoPagamentoAt: null, sepaMandateStatus: 'PENDING' });
    await bloccaAgenziaPerAddebito('f1', 'errore su fee');
    expect(companyUpdate).not.toHaveBeenCalled();
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('no-op se mandato SEPA FAILED (setup non completato)', async () => {
    feeFindUnique.mockResolvedValue({ agenziaId: 'a1' });
    companyFindUnique.mockResolvedValue({ id: 'a1', ragioneSociale: 'Ag', email: 'ag@x.it', bloccoPagamentoAt: null, sepaMandateStatus: 'FAILED' });
    await bloccaAgenziaPerAddebito('f1', 'errore su fee');
    expect(companyUpdate).not.toHaveBeenCalled();
    expect(sendMock).not.toHaveBeenCalled();
  });
});

describe('rivalutaBloccoAgenzia', () => {
  // FIX #2: operazione atomica con singolo updateMany + filtro relazione
  it('chiama updateMany con il filtro relazione corretto per sbloccare', async () => {
    companyUpdateMany.mockResolvedValue({ count: 1 });
    await rivalutaBloccoAgenzia('a1');
    expect(companyUpdateMany).toHaveBeenCalledOnce();
    expect(companyUpdateMany).toHaveBeenCalledWith({
      where: {
        id: 'a1',
        bloccoPagamentoAt: { not: null },
        feeAddebiti: { none: { stato: { in: expect.arrayContaining([...STATI_SCOPERTI]) } } },
      },
      data: { bloccoPagamentoAt: null, bloccoPagamentoMotivo: null },
    });
  });

  it('non sblocca se restano fee scoperti (updateMany risponde count 0 — filtro relazione esclude)', async () => {
    // In prod Postgres il filtro relazione impedisce l'aggiornamento → count 0.
    // Il test verifica che la funzione sia best-effort e non sollevi.
    companyUpdateMany.mockResolvedValue({ count: 0 });
    await expect(rivalutaBloccoAgenzia('a1')).resolves.toBeUndefined();
    expect(companyUpdateMany).toHaveBeenCalledOnce();
  });

  it('best-effort: non propaga errori DB', async () => {
    companyUpdateMany.mockRejectedValue(new Error('db down'));
    await expect(rivalutaBloccoAgenzia('a1')).resolves.toBeUndefined();
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
