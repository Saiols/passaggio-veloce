import 'server-only';
import { prisma } from '@pv/db';
import { processFeeAddebito } from './process';

/**
 * Ri-schedula e processa tutti gli addebiti scoperti (FAILED/RETRY) dell'agenzia.
 * Per-iteration try/catch: un errore su un singolo fee non blocca i successivi.
 * Usata sia dalla remediation action che dal webhook setup_intent.succeeded.
 */
export async function ritentaAddebitiAgenzia(agenziaId: string): Promise<void> {
  const scoperti = await prisma.feeAddebito.findMany({
    where: { agenziaId, stato: { in: ['FAILED', 'RETRY'] } },
    select: { id: true },
  });
  for (const f of scoperti) {
    try {
      await prisma.feeAddebito.update({
        where: { id: f.id },
        data: {
          stato: 'SCHEDULED',
          scheduledAt: new Date(),
          tentativi: { increment: 1 },
          errorMessage: null,
        },
      });
      await processFeeAddebito(f.id);
    } catch (err) {
      console.error(`[ritentaAddebitiAgenzia] errore su fee ${f.id}:`, err);
    }
  }
}
