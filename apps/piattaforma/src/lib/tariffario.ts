import { cache } from 'react';
import { prisma } from '@pv/db';
import { rowToTariffario, type Tariffario } from '@/lib/pricing';

/**
 * Tariffario corrente: la riga `attivo=true` (fallback ai default legacy).
 * Avvolto in React `cache()` → dedup per-request, NESSUNA cache persistente:
 * ogni modifica dal backoffice si riflette subito (anche sui bot).
 */
export const getTariffarioCorrente = cache(
  async (): Promise<Tariffario> =>
    rowToTariffario(
      await prisma.tariffaPiattaforma.findFirst({
        where: { attivo: true },
        orderBy: { createdAt: 'desc' },
      }),
    ),
);
