import 'server-only';
import type { Prisma } from '@pv/db';
import { ANTI_ABUSO } from './constants';

/**
 * Anti-abuso A3: dopo N TIMEOUT consecutivi (no-show senza intermezzo
 * di accettata/rifiutata), l'agenzia viene sospesa automaticamente con
 * audit trail su `Company.suspensionLastNote`.
 *
 * Best-effort: in caso di errore non rilancia. Chiamato dentro la stessa
 * transazione del tick (dopo updateMany TIMEOUT).
 */
export async function checkAutoSuspendForAgenzie(
  tx: Prisma.TransactionClient,
  agenziaIds: readonly string[],
): Promise<{ suspended: string[] }> {
  const suspended: string[] = [];
  if (agenziaIds.length === 0) return { suspended };

  for (const id of agenziaIds) {
    // Carica le ultime N+1 assegnazioni con esito (ordinate desc)
    const recenti = await tx.praticaAssegnazione.findMany({
      where: {
        agenziaId: id,
        esito: { in: ['ACCETTATA', 'RIFIUTATA', 'TIMEOUT'] },
      },
      orderBy: { esitoAt: 'desc' },
      select: { esito: true },
      take: ANTI_ABUSO.AUTO_SUSPEND_TIMEOUT_THRESHOLD,
    });
    if (recenti.length < ANTI_ABUSO.AUTO_SUSPEND_TIMEOUT_THRESHOLD) continue;

    const allTimeout = recenti.every((a) => a.esito === 'TIMEOUT');
    if (!allTimeout) continue;

    // Verifica che non sia già sospesa per evitare doppi marker
    const company = await tx.company.findUnique({
      where: { id },
      select: { suspendedAt: true, deletedAt: true },
    });
    if (!company || company.deletedAt || company.suspendedAt) continue;

    await tx.company.update({
      where: { id },
      data: {
        suspendedAt: new Date(),
        suspensionLastNote: `Auto: ${ANTI_ABUSO.AUTO_SUSPEND_TIMEOUT_THRESHOLD} TIMEOUT consecutivi (anti-abuso A3). Riattivare manualmente da /admin/agenzie dopo verifica.`,
      },
    });
    await tx.user.updateMany({
      where: { companyId: id },
      data: { status: 'SUSPENDED' },
    });
    suspended.push(id);
  }

  return { suspended };
}
