import { NextResponse, type NextRequest } from 'next/server';
import { preavvisoVisura } from '@/lib/jobs/preavviso-visura';
import { requireAdminOrCron } from '@/lib/jobs/auth';

export const maxDuration = 60;

/**
 * Ciclo di vita visura camerale: N46 nei 5 giorni di preavviso (175-179, una al
 * giorno), N47 alla scadenza (>=180, una per ciclo), N48 ai broker delle
 * pratiche congelate. Schedule cron Vercel: 1x/giorno mattina.
 */
async function run(req: NextRequest): Promise<NextResponse> {
  const guard = await requireAdminOrCron(req);
  if (guard) return guard;
  const result = await preavvisoVisura();
  return NextResponse.json({ ok: true, ...result });
}

export const GET = run;
export const POST = run;
