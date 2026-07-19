import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * FIX C (money-integrity): `approveCommissioneAction` promuoveva la commissione
 * leggendo lo stato e poi scrivendo separatamente. Sotto race (READ COMMITTED)
 * due approvazioni simultanee superavano entrambe il check e accreditavano il
 * wallet DUE volte. Il fix è un compare-and-set (`updateMany` DA_REVISIONARE→
 * ACCREDITATA): solo la transazione che trova ancora `count === 1` accredita.
 *
 * Il credito wallet usa inoltre un increment ATOMICO (FIX B, sito 5): il saldo
 * post proviene dal valore restituito dall'UPDATE, non da una somma su lettura.
 *
 * Prisma è mockato: si asseriscono gli ARGOMENTI (forma atomica, gate CAS),
 * non solo l'esito — un mock ritorna il suo valore preconfezionato comunque.
 */

const { prismaMock, txMock, authMock, redirectMock, revalidateMock } = vi.hoisted(() => {
  const txMock = {
    commissioneAffiliazione: { findUnique: vi.fn(), updateMany: vi.fn(), update: vi.fn() },
    wallet: { upsert: vi.fn(), update: vi.fn() },
    transazioneWallet: { create: vi.fn() },
  };
  return {
    txMock,
    prismaMock: {
      $transaction: vi.fn((cb: (tx: typeof txMock) => unknown) => cb(txMock)),
    },
    authMock: vi.fn(),
    redirectMock: vi.fn((url: string) => {
      throw new Error(`__REDIRECT__:${url}`);
    }),
    revalidateMock: vi.fn(),
  };
});

vi.mock('@pv/db', () => ({ prisma: prismaMock }));
vi.mock('@/auth', () => ({ auth: authMock }));
vi.mock('next/navigation', () => ({ redirect: redirectMock }));
vi.mock('next/cache', () => ({ revalidatePath: revalidateMock }));

import { approveCommissioneAction } from './actions';

const CID = 'commissione-1';
const REF = 'referente-1';
const PRAT = 'pratica-1';

function commissione(over: Record<string, unknown> = {}) {
  return {
    id: CID,
    stato: 'DA_REVISIONARE',
    referenteId: REF,
    praticaId: PRAT,
    importoNettoCent: 500,
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  authMock.mockResolvedValue({ user: { id: 'admin-1', role: 'ADMIN_PIATTAFORMA' } });
  txMock.commissioneAffiliazione.findUnique.mockResolvedValue(commissione());
  // CAS vinto di default (1 riga promossa).
  txMock.commissioneAffiliazione.updateMany.mockResolvedValue({ count: 1 });
  txMock.commissioneAffiliazione.update.mockResolvedValue({});
  txMock.wallet.upsert.mockResolvedValue({ id: 'wallet-madre-1', saldoCent: 1_000 });
  // Increment atomico: l'UPDATE restituisce 1_000 + 500 = 1_500.
  txMock.wallet.update.mockResolvedValue({ saldoCent: 1_500 });
  txMock.transazioneWallet.create.mockResolvedValue({ id: 'tw-1' });
});

describe('approveCommissioneAction — CAS + credito atomico', () => {
  it('DA_REVISIONARE, CAS vinto → gate compare-and-set, increment atomico, saldoPostCent dal DB, transazione agganciata', async () => {
    const res = await approveCommissioneAction(CID, 'ok verificato');

    expect(res).toEqual({ ok: true });

    // CAS: la transizione di stato è gatata su stato DA_REVISIONARE (rete finale
    // anti doppio-accredito), con le review fields scritte atomicamente.
    expect(txMock.commissioneAffiliazione.updateMany).toHaveBeenCalledWith({
      where: { id: CID, stato: 'DA_REVISIONARE' },
      data: {
        stato: 'ACCREDITATA',
        reviewedAt: expect.any(Date),
        reviewedById: 'admin-1',
        reviewNotes: 'ok verificato',
      },
    });

    // Credito atomico (increment), non scrittura di un saldo assoluto.
    expect(txMock.wallet.update).toHaveBeenCalledWith({
      where: { id: 'wallet-madre-1' },
      data: { saldoCent: { increment: 500 } },
    });

    // saldoPostCent = valore restituito dall'UPDATE (1_500).
    expect(txMock.transazioneWallet.create).toHaveBeenCalledWith({
      data: {
        walletId: 'wallet-madre-1',
        tipo: 'CREDITO_AFFILIAZIONE',
        importoCent: 500,
        saldoPostCent: 1_500,
        praticaId: PRAT,
      },
    });

    // La transazione viene agganciata alla commissione già promossa dal CAS.
    expect(txMock.commissioneAffiliazione.update).toHaveBeenCalledWith({
      where: { id: CID },
      data: { transazioneWalletId: 'tw-1' },
    });
  });

  it('CAS perso (count 0: un\'altra approvazione concorrente ha già vinto) → NESSUN secondo accredito, esito benigno', async () => {
    txMock.commissioneAffiliazione.updateMany.mockResolvedValue({ count: 0 });

    const res = await approveCommissioneAction(CID);

    // Esito benigno: la commissione è già ACCREDITATA dall'altra transazione.
    expect(res).toEqual({ ok: true });
    // Cruciale: nessun credito wallet, nessuna transazione, nessun aggancio.
    expect(txMock.wallet.upsert).not.toHaveBeenCalled();
    expect(txMock.wallet.update).not.toHaveBeenCalled();
    expect(txMock.transazioneWallet.create).not.toHaveBeenCalled();
    expect(txMock.commissioneAffiliazione.update).not.toHaveBeenCalled();
  });

  it('stato già ACCREDITATA alla findUnique → errore, nessun CAS né accredito', async () => {
    txMock.commissioneAffiliazione.findUnique.mockResolvedValue(commissione({ stato: 'ACCREDITATA' }));

    const res = await approveCommissioneAction(CID);

    expect(res).toEqual({ ok: false, error: 'Stato non valido: ACCREDITATA' });
    expect(txMock.commissioneAffiliazione.updateMany).not.toHaveBeenCalled();
    expect(txMock.wallet.update).not.toHaveBeenCalled();
  });

  it('ruolo non autorizzato → { ok:false }, nessuna transazione', async () => {
    authMock.mockResolvedValue({ user: { id: 'u-assistente', role: 'ASSISTENTE' } });

    const res = await approveCommissioneAction(CID);

    expect(res).toEqual({ ok: false, error: 'Non autorizzato' });
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });
});
