import { NextResponse, type NextRequest } from 'next/server';
import { processFeeScheduled } from '@/lib/jobs/process-fee-scheduled';
import { requireAdminOrCron } from '@/lib/jobs/auth';

/**
 * Processa FeeAddebito SCHEDULED scaduti. Schedule cron Vercel: ogni 6h.
 */
async function run(req: NextRequest): Promise<NextResponse> {
  const guard = await requireAdminOrCron(req);
  if (guard) return guard;
  const result = await processFeeScheduled();
  return NextResponse.json({ ok: true, ...result });
}

export const GET = run;
export const POST = run;
