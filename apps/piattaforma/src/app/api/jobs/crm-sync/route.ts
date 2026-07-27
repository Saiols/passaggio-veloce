import { NextResponse, type NextRequest } from 'next/server';
import { syncCrmFromPlatform } from '@/lib/crm/sync';
import { riconciliaTutto } from '@/lib/crm/match/apply';
import { requireAdminOrCron } from '@/lib/jobs/auth';

export const maxDuration = 60;

/**
 * Sync CRM ↔ piattaforma. Schedule cron Vercel: 1x/giorno (vercel.json).
 * Auth: bearer CRON_SECRET (Vercel Cron) OR sessione ADMIN_PIATTAFORMA.
 *
 * Due passate: prima si agganciano le righe della lista alle aziende
 * registrate (idempotente: chi è già agganciato non viene rivisto), poi si
 * aggiornano gli aggregati dei contatti agganciati.
 */
async function run(req: NextRequest): Promise<NextResponse> {
  const guard = await requireAdminOrCron(req);
  if (guard) return guard;
  const riconciliazione = await riconciliaTutto();
  const result = await syncCrmFromPlatform();
  return NextResponse.json({ ok: true, riconciliazione, ...result });
}

export const GET = run;
export const POST = run;
