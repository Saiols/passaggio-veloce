import { NextResponse, type NextRequest } from 'next/server';
import { tickAllPraticheInDistribuzione } from '@/lib/distribuzione';
import { requireAdminOrCron } from '@/lib/jobs/auth';

/**
 * Tick distribuzione: avanza pratiche in IN_ATTESA_ROUND_X scadute.
 * Schedule cron Vercel: ogni 30min (vercel.json).
 */
async function run(req: NextRequest): Promise<NextResponse> {
  const guard = await requireAdminOrCron(req);
  if (guard) return guard;
  const result = await tickAllPraticheInDistribuzione();
  return NextResponse.json({ ok: true, ...result });
}

export const GET = run;
export const POST = run;
