import { NextResponse, type NextRequest } from 'next/server';
import { triggerAutoPayout } from '@/lib/jobs/trigger-auto-payout';
import { requireAdminOrCron } from '@/lib/jobs/auth';

export const maxDuration = 60;

/**
 * Trigger payout automatici al raggiungimento soglia wallet.
 * Schedule cron Vercel: 1x/giorno notte (dopo process-payouts).
 */
async function run(req: NextRequest): Promise<NextResponse> {
  const guard = await requireAdminOrCron(req);
  if (guard) return guard;
  const result = await triggerAutoPayout();
  return NextResponse.json({ ok: true, ...result });
}

export const GET = run;
export const POST = run;
