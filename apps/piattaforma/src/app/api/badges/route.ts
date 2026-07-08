import { NextResponse } from 'next/server';
import { prisma, type PraticaStato } from '@pv/db';
import { getSessionContext } from '@/lib/auth/session-context';
import {
  toSedeScope,
  wherePraticaAttiva,
  whereAssegnazionePending,
} from '@/lib/sedi/scope-filters';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Stati esclusi dal conteggio "attive": terminali (FIRMATA/ANNULLATA/SCADUTA,
// nessuna azione attesa) + BOZZA (bozze non ancora inviate, non sono lavoro in
// corso). Resta attivo tutto il mezzo: in distribuzione, accettata, processata.
const STATI_ESCLUSI = ['BOZZA', 'FIRMATA', 'ANNULLATA', 'SCADUTA'] as unknown as PraticaStato[];

/**
 * Conteggi per i badge di navigazione (polled dal client via NavBadge).
 * Multi-sede: i conteggi seguono le sedi in scope, ESATTAMENTE come le liste
 * che aprono. Un badge madre-wide su una lista sede-scopata produceva il
 * classico "numerino pieno, lista vuota".
 */
export async function GET(): Promise<Response> {
  const ctx = await getSessionContext();
  if (!ctx) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let inbox = 0;
  let praticheAttive = 0;
  const companyId = ctx.companyId;
  const companyType = ctx.user.companyType as 'AGENZIA' | 'DEALER' | undefined;
  const scope = toSedeScope(ctx);

  if (companyId && companyType === 'AGENZIA') {
    inbox = await prisma.praticaAssegnazione.count({
      where: whereAssegnazionePending(scope, companyId),
    });
    praticheAttive = await prisma.pratica.count({
      where: {
        ...wherePraticaAttiva(scope, { companyId, ruolo: 'AGENZIA' }),
        stato: { notIn: STATI_ESCLUSI },
      },
    });
  } else if (companyId && companyType === 'DEALER') {
    praticheAttive = await prisma.pratica.count({
      where: {
        ...wherePraticaAttiva(scope, { companyId, ruolo: 'DEALER' }),
        stato: { notIn: STATI_ESCLUSI },
      },
    });
  }

  return NextResponse.json(
    { inbox, praticheAttive },
    { headers: { 'Cache-Control': 'private, no-store' } },
  );
}
