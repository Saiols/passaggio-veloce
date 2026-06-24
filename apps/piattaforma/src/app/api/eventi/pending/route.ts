import { NextResponse } from 'next/server';
import { getSessionContext } from '@/lib/auth/session-context';
import { prisma } from '@pv/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/eventi/pending — eventi pratica in-app non ancora visti dalla sede
 * operativa in sessione (broker/agenzia), dal più recente. Alimenta la modale.
 * Multi-sede: filtra per sede (scopeIds) con fallback agli eventi a livello
 * madre (targetSedeId null) per non perdere eventi legacy/non convertiti.
 */
export async function GET(): Promise<Response> {
  const ctx = await getSessionContext();
  const companyId = ctx?.companyId;
  if (!companyId) {
    return NextResponse.json({ eventi: [] }, { headers: { 'Cache-Control': 'private, no-store' } });
  }
  const scopeIds = ctx?.scopeIds ?? [];

  try {
    const eventi = await prisma.eventoPratica.findMany({
      where: {
        seenAt: null,
        OR: [
          { targetSedeId: { in: scopeIds } },
          { targetSedeId: null, targetCompanyId: companyId },
        ],
      },
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
