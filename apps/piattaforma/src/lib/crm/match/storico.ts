import 'server-only';
import { prisma } from '@pv/db';
import type { Storico } from './stato';

/**
 * Storico reale di un'azienda registrata: quante pratiche ha firmato, quando
 * ha firmato la prima, se è sospesa/cancellata, se è arrivata da un referral.
 *
 * Fonte unica dei due consumatori che devono allineare il funnel di un
 * contatto CRM: `apply.ts` (aggancio) e `sync.ts#onPraticaFirmata` (firma).
 */
export async function storicoAzienda(
  companyId: string,
  cat: 'BROKER' | 'AGENZIA',
): Promise<Storico | null> {
  // Le pratiche di un'agenzia stanno su agenziaAssegnataId, non su brokerId.
  const wherePratica =
    cat === 'AGENZIA' ? { agenziaAssegnataId: companyId } : { brokerId: companyId };

  const [company, firmate, prima] = await Promise.all([
    prisma.company.findUnique({
      where: { id: companyId },
      select: {
        suspendedAt: true,
        deletedAt: true,
        referenteId: true,
      },
    }),
    prisma.pratica.count({
      where: { ...wherePratica, deletedAt: null, stato: 'FIRMATA' },
    }),
    prisma.pratica.findFirst({
      where: { ...wherePratica, deletedAt: null, stato: 'FIRMATA' },
      orderBy: { firmaAvvenutaAt: 'asc' },
      select: { firmaAvvenutaAt: true },
    }),
  ]);
  if (!company) return null;

  return {
    firmate,
    primaPraticaAt: prima?.firmaAvvenutaAt ?? null,
    sospesa: !!company.suspendedAt || !!company.deletedAt,
    referral: !!company.referenteId,
  };
}
