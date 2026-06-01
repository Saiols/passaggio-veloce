import { NextResponse, type NextRequest } from 'next/server';
import { purgeDeletedDocumenti } from '@/lib/jobs/purge-deleted-documenti';
import { requireAdminOrCron } from '@/lib/jobs/auth';

async function run(req: NextRequest): Promise<NextResponse> {
  const guard = await requireAdminOrCron(req);
  if (guard) return guard;
  const result = await purgeDeletedDocumenti();
  return NextResponse.json({ ok: true, ...result });
}

export const GET = run;
export const POST = run;
