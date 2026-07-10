import type { Prisma } from '@pv/db';

/**
 * Filtro range date sul `refDate` di un addebito, ossia `scheduledAt ?? createdAt`
 * (lo stesso campo mostrato/raggruppato nello storico). `null` se il range è vuoto.
 *
 * Le righe con `scheduledAt` valorizzato si filtrano su `scheduledAt`; quelle con
 * `scheduledAt` null ricadono su `createdAt`.
 */
export function feeRefDateWhere(range: {
  gte?: Date;
  lte?: Date;
}): Prisma.FeeAddebitoWhereInput | null {
  if (!range.gte && !range.lte) return null;
  const bound: { gte?: Date; lte?: Date } = {};
  if (range.gte) bound.gte = range.gte;
  if (range.lte) bound.lte = range.lte;
  return {
    OR: [{ scheduledAt: bound }, { AND: [{ scheduledAt: null }, { createdAt: bound }] }],
  };
}
