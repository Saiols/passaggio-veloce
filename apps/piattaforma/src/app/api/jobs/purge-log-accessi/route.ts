import { NextResponse, type NextRequest } from 'next/server';
import { purgeLogAccessi } from '@/lib/jobs/purge-log-accessi';
import { requireAdminOrCron } from '@/lib/jobs/auth';

export const maxDuration = 60;

async function run(req: NextRequest): Promise<NextResponse> {
  const guard = await requireAdminOrCron(req);
  if (guard) return guard;
  const result = await purgeLogAccessi();
  return NextResponse.json({ ok: true, ...result });
}

export const GET = run;
export const POST = run;
