import { cache } from 'react';
import { prisma } from '@pv/db';
import { rowToTariffario, DEFAULT_TARIFFARIO, type Tariffario } from '@/lib/pricing';

/**
 * Tariffario corrente: la riga `attivo=true` (fallback ai default legacy).
 * Avvolto in React `cache()` → dedup per-request, NESSUNA cache persistente:
 * ogni modifica dal backoffice si riflette subito (anche sui bot).
 *
 * Fail-open su qualunque errore della query (non solo riga assente): questa
 * funzione è usata anche dalla landing pubblica e da /llms.txt, che prima
 * erano statici (nessun DB coinvolto). Un blip del DB non deve tradursi in
 * un 500 su superfici pubbliche/SEO — stessa logica fail-open già adottata
 * per il bot.
 */
export const getTariffarioCorrente = cache(async (): Promise<Tariffario> => {
  try {
    return rowToTariffario(
      await prisma.tariffaPiattaforma.findFirst({
        where: { attivo: true },
        orderBy: { createdAt: 'desc' },
      }),
    );
  } catch {
    return DEFAULT_TARIFFARIO;
  }
});
