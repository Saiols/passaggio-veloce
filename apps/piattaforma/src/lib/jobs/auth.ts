import { NextResponse, type NextRequest } from 'next/server';
import { auth } from '@/auth';

/**
 * Auth condivisa per gli endpoint /api/jobs/*.
 *
 * Accetta DUE percorsi di autenticazione:
 *
 * 1. **Cron Vercel** — header `Authorization: Bearer <CRON_SECRET>` con
 *    `CRON_SECRET` env var configurata su Vercel. È il pattern standard
 *    di Vercel Cron (vedi vercel.json).
 *
 * 2. **UI admin manuale** — sessione `ADMIN_PIATTAFORMA` (usata da
 *    /admin/demo-control per trigger durante sviluppo/demo).
 *
 * Restituisce `null` se autorizzato, oppure una `NextResponse 401/403`
 * pronta da rispedire al client.
 */
export async function requireAdminOrCron(
  req: NextRequest,
): Promise<NextResponse | null> {
  // Cron: bearer secret. Vercel imposta `Authorization: Bearer <CRON_SECRET>`.
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = req.headers.get('authorization');
    if (auth === `Bearer ${cronSecret}`) {
      return null;
    }
  }

  // UI admin
  const session = await getSession();
  if (session?.user?.role === 'ADMIN_PIATTAFORMA') {
    return null;
  }

  return NextResponse.json({ error: 'forbidden' }, { status: 403 });
}

async function getSession() {
  try {
    return await auth();
  } catch {
    return null;
  }
}
