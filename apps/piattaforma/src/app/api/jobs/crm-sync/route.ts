import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { syncCrmFromPlatform } from '@/lib/crm/sync';

/**
 * Trigger manuale del sync CRM ↔ piattaforma.
 * In prod diventerà Vercel Cron / GitHub Actions schedule (1x/giorno).
 *
 * Auth:
 * - Browser (UI admin): richiede sessione ADMIN_PIATTAFORMA
 * - Script/cron: header X-Cron-Secret uguale a env CRON_SECRET (futuro)
 */
export async function POST() {
  const session = await auth();
  if (session?.user?.role !== 'ADMIN_PIATTAFORMA') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const result = await syncCrmFromPlatform();
  return NextResponse.json({ ok: true, ...result });
}
