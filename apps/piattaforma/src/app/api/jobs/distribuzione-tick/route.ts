import { NextResponse, type NextRequest } from 'next/server';
import { tickAllPraticheInDistribuzione } from '@/lib/distribuzione';
import { requireAdminOrCron } from '@/lib/jobs/auth';

export const maxDuration = 60;

/**
 * Tick distribuzione: espande il raggio delle pratiche IN_DISTRIBUZIONE in
 * orario lavorativo (un anello non vuoto per tick, gate 10 min).
 * Schedule cron Vercel: ogni 10min (vercel.json).
 */
async function run(req: NextRequest): Promise<NextResponse> {
  const guard = await requireAdminOrCron(req);
  if (guard) return guard;
  const result = await tickAllPraticheInDistribuzione();
  return NextResponse.json({ ok: true, ...result });
}

export const GET = run;
export const POST = run;
