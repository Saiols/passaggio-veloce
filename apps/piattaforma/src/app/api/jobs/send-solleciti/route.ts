import { NextResponse, type NextRequest } from 'next/server';
import { sendSolleciti } from '@/lib/jobs/send-solleciti';
import { requireAdminOrCron } from '@/lib/jobs/auth';

/**
 * Invia N3 (broker, ogni 5gg senza firma) + N7 (agenzia, promemoria
 * countdown). Schedule cron Vercel: 1x/giorno mattina.
 */
async function run(req: NextRequest): Promise<NextResponse> {
  const guard = await requireAdminOrCron(req);
  if (guard) return guard;
  const result = await sendSolleciti();
  return NextResponse.json({ ok: true, ...result });
}

export const GET = run;
export const POST = run;
