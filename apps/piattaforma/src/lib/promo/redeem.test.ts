import { describe, it, expect, vi } from 'vitest';
import { redeemPromoCode } from './redeem';

function makeTx(promo: unknown, count = 0) {
  return {
    promoCode: { findUnique: vi.fn().mockResolvedValue(promo) },
    promoCodeRedemption: { count: vi.fn().mockResolvedValue(count), create: vi.fn().mockResolvedValue({ id: 'r1' }) },
    wallet: {
      upsert: vi.fn().mockResolvedValue({ id: 'w1', saldoCent: 1000 }),
      update: vi.fn().mockResolvedValue({}),
    },
    transazioneWallet: { create: vi.fn().mockResolvedValue({ id: 't1' }) },
  };
}

const validPromo = { id: 'p1', amountCent: 5000, expiresAt: null, active: true, maxRedemptions: null };

describe('redeemPromoCode', () => {
  it('codice vuoto → applied:false, nessuna scrittura', async () => {
    const tx = makeTx(null);
    const r = await redeemPromoCode(tx as never, '   ', 'c1');
    expect(r).toEqual({ applied: false });
    expect(tx.transazioneWallet.create).not.toHaveBeenCalled();
  });

  it('inesistente → applied:false', async () => {
    const tx = makeTx(null);
    const r = await redeemPromoCode(tx as never, 'NOPE', 'c1');
    expect(r).toEqual({ applied: false });
    expect(tx.wallet.upsert).not.toHaveBeenCalled();
  });

  it('valido → accredita wallet + crea redemption, applied:true', async () => {
    const tx = makeTx(validPromo, 0);
    const r = await redeemPromoCode(tx as never, ' benv ', 'c1');
    expect(r).toEqual({ applied: true, amountCent: 5000 });
    expect(tx.transazioneWallet.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ walletId: 'w1', tipo: 'CREDITO_PROMO', importoCent: 5000, saldoPostCent: 6000 }) }),
    );
    expect(tx.wallet.update).toHaveBeenCalledWith({ where: { id: 'w1' }, data: { saldoCent: 6000 } });
    expect(tx.promoCodeRedemption.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ promoCodeId: 'p1', companyId: 'c1', amountCent: 5000, transazioneWalletId: 't1' }) }),
    );
  });

  it('esaurito → applied:false, nessun accredito', async () => {
    const tx = makeTx({ ...validPromo, maxRedemptions: 1 }, 1);
    const r = await redeemPromoCode(tx as never, 'X', 'c1');
    expect(r).toEqual({ applied: false });
    expect(tx.transazioneWallet.create).not.toHaveBeenCalled();
  });
});
