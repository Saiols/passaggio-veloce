import 'server-only';
import type { Prisma } from '@pv/db';
import { ANTI_ABUSO } from './constants';

/**
 * Anti-abuso A3 (multi-sede): dopo N TIMEOUT consecutivi (no-show senza
 * intermezzo di accettata/rifiutata), la SEDE viene sospesa automaticamente
 * (`Sede.suspendedAt`). La distribuzione esclude le sedi sospese; le altre sedi
 * della stessa madre restano attive, e gli utenti (che possono operare più sedi)
 * NON vengono toccati.
 *
 * Best-effort: in caso di errore non rilancia. Chiamato dentro la stessa
 * transazione del tick (dopo updateMany TIMEOUT).
 */
export async function checkAutoSuspendForSedi(
  tx: Prisma.TransactionClient,
  sedeIds: readonly string[],
): Promise<{ suspended: string[] }> {
  const suspended: string[] = [];
  if (sedeIds.length === 0) return { suspended };

  for (const id of sedeIds) {
    // Carica le ultime N assegnazioni della sede con esito (ordinate desc)
    const recenti = await tx.praticaAssegnazione.findMany({
      where: {
        sedeId: id,
        esito: { in: ['ACCETTATA', 'RIFIUTATA', 'TIMEOUT'] },
      },
      orderBy: { esitoAt: 'desc' },
      select: { esito: true },
      take: ANTI_ABUSO.AUTO_SUSPEND_TIMEOUT_THRESHOLD,
    });
    if (recenti.length < ANTI_ABUSO.AUTO_SUSPEND_TIMEOUT_THRESHOLD) continue;

    const allTimeout = recenti.every((a) => a.esito === 'TIMEOUT');
    if (!allTimeout) continue;

    // Verifica che non sia già sospesa/eliminata per evitare doppi marker
    const sede = await tx.sede.findUnique({
      where: { id },
      select: { suspendedAt: true, deletedAt: true },
    });
    if (!sede || sede.deletedAt || sede.suspendedAt) continue;

    await tx.sede.update({
      where: { id },
      data: { suspendedAt: new Date() },
    });
    suspended.push(id);
  }

  return { suspended };
}
