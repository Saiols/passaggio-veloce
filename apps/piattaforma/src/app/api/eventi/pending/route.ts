import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { prisma } from '@pv/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/eventi/pending — eventi pratica in-app non ancora visti dall'azienda
 * in sessione (broker/agenzia), dal più recente. Alimenta la modale globale.
 */
export async function GET(): Promise<Response> {
  const session = await auth();
  const companyId = session?.user?.companyId;
  if (!companyId) {
    return NextResponse.json({ eventi: [] }, { headers: { 'Cache-Control': 'private, no-store' } });
  }

  try {
    const eventi = await prisma.eventoPratica.findMany({
      where: { targetCompanyId: companyId, seenAt: null },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: {
        id: true,
        tipo: true,
        titolo: true,
        testo: true,
        ctaLabel: true,
        ctaHref: true,
        praticaId: true,
        createdAt: true,
      },
    });
    return NextResponse.json({ eventi }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch {
    // Resiliente: se la tabella non esiste ancora (migration prod non applicata)
    // o qualsiasi errore DB, degrada a "nessun evento" invece di 500.
    return NextResponse.json({ eventi: [] }, { headers: { 'Cache-Control': 'private, no-store' } });
  }
}
