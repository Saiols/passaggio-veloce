import 'server-only';
import type { Prisma } from '@pv/db';
import { normalizePromoCode, evaluatePromoCode } from './evaluate';

export type PromoRedeemResult = { applied: true; amountCent: number } | { applied: false };

/**
 * Riscatta un codice promozionale dentro una transazione (passata dal chiamante).
 * Va invocata POST-commit della registrazione, in una transazione dedicata, cosi'
 * un eventuale errore non puo' annullare la registrazione gia' andata a buon fine.
 * Best-effort applicativo: se il codice non è valido ritorna { applied: false }.
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

  // Il bonus iscrizione è un credito OPERATIVO → va sul wallet di SEDE (come i
  // crediti pratica: è quello letto da /wallet e dalla dashboard), NON sul wallet
  // madre (companyId) che è riservato alle commissioni di affiliazione. Lo
  // accreditiamo sulla sede principale dell'azienda = la prima creata (la sede
  // "dai dati azienda" generata in registrazione). Single-sede → univoca.
  const sede = await tx.sede.findFirst({
    where: { companyId, deletedAt: null },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });
  if (!sede) return { applied: false };

  const wallet = await tx.wallet.upsert({
    where: { sedeId: sede.id },
    create: { sedeId: sede.id, saldoCent: 0 },
    update: {},
  });
  // Incremento atomico (no leggi-poi-scrivi): l'UPDATE va PRIMA della
  // transazione così il saldo post proviene dal valore restituito dal DB e un
  // accredito concorrente sullo stesso wallet non viene sovrascritto.
  const w = await tx.wallet.update({
    where: { id: wallet.id },
    data: { saldoCent: { increment: res.amountCent } },
  });
  const transazione = await tx.transazioneWallet.create({
    data: {
      walletId: wallet.id,
      tipo: 'CREDITO_PROMO',
      importoCent: res.amountCent,
      saldoPostCent: w.saldoCent,
      note: `Codice promozionale ${code}`,
    },
  });
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
