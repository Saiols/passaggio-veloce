import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { tickAllPraticheInDistribuzione } from '@/lib/distribuzione';

/**
 * Trigger manuale del ciclo di distribuzione.
 * In prod diventerà Vercel Cron / GitHub Actions schedule.
 *
 * Auth:
 * - Browser (UI admin): richiede sessione ADMIN_PIATTAFORMA
 * - Script/cron: header X-Cron-Secret uguale a env CRON_SECRET (non ancora
 *   configurato — finché env.CRON_SECRET non esiste, solo admin via UI)
 */
export async function POST() {
  const session = await auth();
  if (session?.user?.role !== 'ADMIN_PIATTAFORMA') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const result = await tickAllPraticheInDistribuzione();
  return NextResponse.json({ ok: true, ...result });
}
