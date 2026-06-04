import 'server-only';
import type { Prisma } from '@pv/db';
import { normalizePromoCode, evaluatePromoCode } from './evaluate';

export type PromoRedeemResult = { applied: true; amountCent: number } | { applied: false };

/**
 * Riscatta un codice promozionale DENTRO una transazione di registrazione.
 * Best-effort: se il codice non è valido ritorna { applied: false } senza errori.
 */
export async function redeemPromoCode(
  tx: Prisma.TransactionClient,
  codeRaw: string,
  companyId: string,
): Promise<PromoRedeemResult> {
  const code = normalizePromoCode(codeRaw);
  if (!code) return { applied: false };

  const promo = await tx.promoCode.findUnique({
    where: { code },
    select: { id: true, amountCent: true, expiresAt: true, active: true, maxRedemptions: true },
  });
  const count = promo ? await tx.promoCodeRedemption.count({ where: { promoCodeId: promo.id } }) : 0;
  const res = evaluatePromoCode(promo, count);
  if (res.stato !== 'valido' || !promo) return { applied: false };

  const wallet = await tx.wallet.upsert({
    where: { companyId },
    create: { companyId, saldoCent: 0 },
    update: {},
  });
  const nuovoSaldo = wallet.saldoCent + res.amountCent;
  const transazione = await tx.transazioneWallet.create({
    data: {
      walletId: wallet.id,
      tipo: 'CREDITO_PROMO',
      importoCent: res.amountCent,
      saldoPostCent: nuovoSaldo,
      note: `Codice promozionale ${code}`,
    },
  });
  await tx.wallet.update({ where: { id: wallet.id }, data: { saldoCent: nuovoSaldo } });
  await tx.promoCodeRedemption.create({
    data: {
      promoCodeId: promo.id,
      companyId,
      amountCent: res.amountCent,
      transazioneWalletId: transazione.id,
    },
  });
  return { applied: true, amountCent: res.amountCent };
}
