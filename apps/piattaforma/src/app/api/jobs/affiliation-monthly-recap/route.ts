import { NextResponse, type NextRequest } from 'next/server';
import { affiliationMonthlyRecap } from '@/lib/jobs/affiliation-monthly-recap';
import { requireAdminOrCron } from '@/lib/jobs/auth';

/**
 * Recap mensile affiliazione N25. Schedule cron Vercel: 1° del mese 9:00.
 */
async function run(req: NextRequest): Promise<NextResponse> {
  const guard = await requireAdminOrCron(req);
  if (guard) return guard;
  const result = await affiliationMonthlyRecap();
  return NextResponse.json({ ok: true, ...result });
}

export const GET = run;
export const POST = run;
