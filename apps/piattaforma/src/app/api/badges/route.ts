import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { prisma } from '@pv/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Conteggi per i badge di navigazione (polled dal client). Endpoint generico:
 * oggi ritorna solo `inbox` (pratiche in arrivo per l'agenzia), estendibile.
 */
export async function GET(): Promise<Response> {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let inbox = 0;
  if (session.user.companyType === 'AGENZIA' && session.user.companyId) {
    inbox = await prisma.praticaAssegnazione.count({
      where: { agenziaId: session.user.companyId, esito: 'PENDING' },
    });
  }

  return NextResponse.json(
    { inbox },
    { headers: { 'Cache-Control': 'private, no-store' } },
  );
}
