import { NextResponse, type NextRequest } from 'next/server';
import { processPayouts } from '@/lib/jobs/process-payouts';
import { requireAdminOrCron } from '@/lib/jobs/auth';

export const maxDuration = 60;

/**
 * Processa payout pendenti. Schedule cron Vercel: 1x/giorno notte.
 */
async function run(req: NextRequest): Promise<NextResponse> {
  const guard = await requireAdminOrCron(req);
  if (guard) return guard;
  const result = await processPayouts();
  return NextResponse.json({ ok: true, ...result });
}

export const GET = run;
export const POST = run;
