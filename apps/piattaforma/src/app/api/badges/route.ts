import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { prisma, type PraticaStato } from '@pv/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Stati esclusi dal conteggio "attive": terminali (FIRMATA/ANNULLATA/SCADUTA,
// nessuna azione attesa) + BOZZA (bozze non ancora inviate, non sono lavoro in
// corso). Resta attivo tutto il mezzo: in distribuzione, accettata, processata.
const STATI_ESCLUSI = ['BOZZA', 'FIRMATA', 'ANNULLATA', 'SCADUTA'] as unknown as PraticaStato[];

/**
 * Conteggi per i badge di navigazione (polled dal client via NavBadge).
 * - `inbox`: pratiche in arrivo da accettare (solo agenzia).
 * - `praticheAttive`: totale pratiche non concluse dell'azienda (broker o
 *   agenzia assegnata), mostrato sulla voce "Pratiche" della sidebar.
 */
export async function GET(): Promise<Response> {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let inbox = 0;
  let praticheAttive = 0;
  const companyId = session.user.companyId;

  if (companyId) {
    if (session.user.companyType === 'AGENZIA') {
      inbox = await prisma.praticaAssegnazione.count({
        where: { agenziaId: companyId, esito: 'PENDING' },
      });
      praticheAttive = await prisma.pratica.count({
        where: {
          agenziaAssegnataId: companyId,
          deletedAt: null,
          stato: { notIn: STATI_ESCLUSI },
        },
      });
    } else if (session.user.companyType === 'DEALER') {
      praticheAttive = await prisma.pratica.count({
        where: {
          brokerId: companyId,
          deletedAt: null,
          stato: { notIn: STATI_ESCLUSI },
        },
      });
    }
  }

  return NextResponse.json(
    { inbox, praticheAttive },
    { headers: { 'Cache-Control': 'private, no-store' } },
  );
}
