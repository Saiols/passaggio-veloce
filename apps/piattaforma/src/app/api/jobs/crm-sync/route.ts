import { NextResponse, type NextRequest } from 'next/server';
import { syncCrmFromPlatform } from '@/lib/crm/sync';
import { requireAdminOrCron } from '@/lib/jobs/auth';

export const maxDuration = 60;

/**
 * Sync CRM ↔ piattaforma. Schedule cron Vercel: 1x/giorno (vercel.json).
 * Auth: bearer CRON_SECRET (Vercel Cron) OR sessione ADMIN_PIATTAFORMA.
 */
async function run(req: NextRequest): Promise<NextResponse> {
  const guard = await requireAdminOrCron(req);
  if (guard) return guard;
  const result = await syncCrmFromPlatform();
  return NextResponse.json({ ok: true, ...result });
}

export const GET = run;
export const POST = run;
