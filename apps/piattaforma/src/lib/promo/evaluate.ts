export type PromoEvalInput = {
  amountCent: number;
  expiresAt: Date | null;
  active: boolean;
  maxRedemptions: number | null;
} | null;

export type PromoCheckResult =
  | { stato: 'inesistente' }
  | { stato: 'scaduto' }
  | { stato: 'esaurito' }
  | { stato: 'valido'; amountCent: number };

export function normalizePromoCode(code: string): string {
  return code.trim().toUpperCase();
}

export function evaluatePromoCode(
  promo: PromoEvalInput,
  redemptionsCount: number,
  now: Date = new Date(),
): PromoCheckResult {
  if (!promo || !promo.active) return { stato: 'inesistente' };
  if (promo.expiresAt && promo.expiresAt.getTime() < now.getTime()) return { stato: 'scaduto' };
  if (promo.maxRedemptions != null && redemptionsCount >= promo.maxRedemptions) return { stato: 'esaurito' };
  return { stato: 'valido', amountCent: promo.amountCent };
}
