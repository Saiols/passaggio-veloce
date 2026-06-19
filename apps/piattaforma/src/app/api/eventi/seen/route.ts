import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { prisma } from '@pv/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/eventi/seen — marca un evento come visto (chiusura modale).
 * Body: { id }. Vincolato alla company in sessione: non si possono marcare
 * eventi di altre aziende.
 */
export async function POST(req: Request): Promise<Response> {
  const session = await auth();
  const companyId = session?.user?.companyId;
  const userId = session?.user?.id;
  if (!companyId) return NextResponse.json({ ok: false }, { status: 401 });

  const body = (await req.json().catch(() => null)) as { id?: unknown } | null;
  const id = typeof body?.id === 'string' ? body.id : null;
  if (!id) return NextResponse.json({ ok: false, error: 'id mancante' }, { status: 400 });

  await prisma.eventoPratica.updateMany({
    where: { id, targetCompanyId: companyId, seenAt: null },
    data: { seenAt: new Date(), seenByUserId: userId ?? null },
  });

  return NextResponse.json({ ok: true });
}
