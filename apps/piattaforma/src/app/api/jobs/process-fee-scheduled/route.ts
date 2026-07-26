import { NextResponse, type NextRequest } from 'next/server';
import { processFeeScheduled } from '@/lib/jobs/process-fee-scheduled';
import { requireAdminOrCron } from '@/lib/jobs/auth';

export const maxDuration = 60;

/**
 * Rete di recupero degli addebiti: l'addebito normale parte dalla firma
 * (firma-engine.ts). Qui restano il reaper, i retry orfani e i fee la cui
 * chiamata dalla firma non è mai partita. Schedule cron Vercel: ogni ora.
 */
async function run(req: NextRequest): Promise<NextResponse> {
  const guard = await requireAdminOrCron(req);
  if (guard) return guard;
  const result = await processFeeScheduled();
  return NextResponse.json({ ok: true, ...result });
}

export const GET = run;
export const POST = run;
