import 'server-only';
import { prisma } from '@pv/db';
import { sendNotification } from '@/lib/notifiche';
import { env } from '@/env';

/** Stati di un FeeAddebito che tengono l'agenzia bloccata (scoperto o in volo). */
export const STATI_SCOPERTI = ['FAILED', 'RETRY', 'IN_LAVORAZIONE'] as const;

/**
 * Blocca l'agenzia per un addebito non riuscito. Best-effort, idempotente:
 * setta bloccoPagamentoAt solo alla prima transizione (e allora invia N9);
 * se già bloccata aggiorna solo il motivo. Non propaga errori.
 *
 * SAFETY: se il mandato SEPA non è ACTIVE (es. ancora PENDING o setup FAILED),
 * l'addebito non è mai avvenuto davvero — è un gap di configurazione, non un
 * rifiuto della banca. In quel caso NON blocchiamo l'agenzia.
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
      select: {
        id: true,
        ragioneSociale: true,
        email: true,
        bloccoPagamentoAt: true,
        sepaMandateStatus: true,
        // Destinatario = email di registrazione dell'admin azienda.
        users: {
          where: { role: 'ADMIN_AZIENDA', status: 'ACTIVE' },
          select: { id: true, email: true },
          take: 1,
        },
      },
    });
    if (!agenzia) return;
    // Skip: mandato non attivo → gap di setup, non rifiuto bancario.
    if (agenzia.sepaMandateStatus !== 'ACTIVE') return;
    const giaBloccata = !!agenzia.bloccoPagamentoAt;
    await prisma.company.update({
      where: { id: agenzia.id },
      data: {
        ...(giaBloccata ? {} : { bloccoPagamentoAt: new Date() }),
        bloccoPagamentoMotivo: motivo.slice(0, 1000),
      },
    });
    if (!giaBloccata) {
      const admin = agenzia.users[0];
      await sendNotification({
        tipo: 'N9_AGENZIA_ADDEBITO_FALLITO',
        target: {
          email: admin?.email ?? agenzia.email,
          userId: admin?.id ?? null,
          companyId: agenzia.id,
        },
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
 * (FAILED/RETRY/IN_LAVORAZIONE). Operazione ATOMICA: un singolo updateMany
 * con filtro relazione elimina la race condition count→update. Best-effort.
 */
export async function rivalutaBloccoAgenzia(agenziaId: string): Promise<void> {
  try {
    await prisma.company.updateMany({
      where: {
        id: agenziaId,
        bloccoPagamentoAt: { not: null },
        feeAddebiti: { none: { stato: { in: [...STATI_SCOPERTI] } } },
      },
      data: { bloccoPagamentoAt: null, bloccoPagamentoMotivo: null },
    });
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
