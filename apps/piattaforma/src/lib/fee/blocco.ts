import 'server-only';
import { prisma } from '@pv/db';
import { sendNotification } from '@/lib/notifiche';
import { env } from '@/env';

/** Stati di un FeeAddebito che tengono l'agenzia bloccata (scoperto o in volo). */
const STATI_SCOPERTI = ['FAILED', 'RETRY', 'IN_LAVORAZIONE'] as const;

/**
 * Blocca l'agenzia per un addebito non riuscito. Best-effort, idempotente:
 * setta bloccoPagamentoAt solo alla prima transizione (e allora invia N9);
 * se già bloccata aggiorna solo il motivo. Non propaga errori.
 */
export async function bloccaAgenziaPerAddebito(feeId: string, motivo: string): Promise<void> {
  try {
    const fee = await prisma.feeAddebito.findUnique({
      where: { id: feeId },
      select: { agenziaId: true },
    });
    if (!fee) return;
    const agenzia = await prisma.company.findUnique({
      where: { id: fee.agenziaId },
      select: { id: true, ragioneSociale: true, email: true, bloccoPagamentoAt: true },
    });
    if (!agenzia) return;
    const giaBloccata = !!agenzia.bloccoPagamentoAt;
    await prisma.company.update({
      where: { id: agenzia.id },
      data: {
        ...(giaBloccata ? {} : { bloccoPagamentoAt: new Date() }),
        bloccoPagamentoMotivo: motivo.slice(0, 1000),
      },
    });
    if (!giaBloccata) {
      await sendNotification({
        tipo: 'N9_AGENZIA_ADDEBITO_FALLITO',
        target: { email: agenzia.email, companyId: agenzia.id },
        payload: {
          nomeAgenzia: agenzia.ragioneSociale,
          rimedioUrl: `${env.NEXT_PUBLIC_APP_URL}/blocco-pagamento`,
        },
      }).catch(() => undefined);
    }
  } catch {
    // best-effort: un errore qui non deve rompere il flusso di addebito
  }
}

/**
 * Sblocca l'agenzia se non ha più alcun addebito scoperto o in volo
 * (FAILED/RETRY/IN_LAVORAZIONE). Best-effort, idempotente.
 */
export async function rivalutaBloccoAgenzia(agenziaId: string): Promise<void> {
  try {
    const agenzia = await prisma.company.findUnique({
      where: { id: agenziaId },
      select: { bloccoPagamentoAt: true },
    });
    if (!agenzia?.bloccoPagamentoAt) return;
    const scoperti = await prisma.feeAddebito.count({
      where: { agenziaId, stato: { in: ['FAILED', 'RETRY', 'IN_LAVORAZIONE'] } },
    });
    if (scoperti === 0) {
      await prisma.company.update({
        where: { id: agenziaId },
        data: { bloccoPagamentoAt: null, bloccoPagamentoMotivo: null },
      });
    }
  } catch {
    // best-effort
  }
}

/** True se l'agenzia è bloccata per addebito non riuscito. */
export async function isAgenziaBloccata(agenziaId: string): Promise<boolean> {
  const c = await prisma.company.findUnique({
    where: { id: agenziaId },
    select: { bloccoPagamentoAt: true },
  });
  return !!c?.bloccoPagamentoAt;
}
